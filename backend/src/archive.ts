import { createGunzip } from "zlib";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve, normalize, extname, basename } from "path";
import { extract as tarExtract } from "tar-stream";

const MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_FILE_COUNT = 50;
const MAX_FILENAME_LENGTH = 255;
const MAX_PATH_DEPTH = 10;
const EXTRACTION_TIMEOUT_MS = 10_000;

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

/**
 * Validates that a buffer starts with gzip magic bytes (0x1f, 0x8b).
 */
export function validateArchiveFormat(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/**
 * Validates a tar entry name for security issues.
 * Throws ArchiveValidationError if the name is invalid.
 */
function validateEntryName(name: string, extractDir: string): void {
  // Check for null bytes
  if (name.includes("\0")) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }

  // Check for non-printable characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }

  // Check filename length
  if (name.length > MAX_FILENAME_LENGTH) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }

  // Check for .. path segments
  const segments = name.split("/");
  if (segments.some((s) => s === "..")) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }

  // Check path depth
  const nonEmptySegments = segments.filter((s) => s.length > 0);
  if (nonEmptySegments.length > MAX_PATH_DEPTH) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }

  // Check for absolute paths
  if (name.startsWith("/")) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }

  // Resolve and verify path stays within extraction directory
  const resolved = resolve(extractDir, normalize(name));
  const normalizedExtractDir = resolve(extractDir);
  if (!resolved.startsWith(normalizedExtractDir + "/") && resolved !== normalizedExtractDir) {
    throw new ArchiveValidationError(
      "Archive contains invalid path: entry attempts to escape extraction directory",
    );
  }
}

/**
 * Validates the entry type — only regular files and directories are allowed.
 */
function validateEntryType(type: string): void {
  if (type === "symlink" || type === "link") {
    throw new ArchiveValidationError(
      "Archive contains unsupported entry type: symlinks are not allowed",
    );
  }

  if (type !== "file" && type !== "directory") {
    throw new ArchiveValidationError(
      "Archive contains unsupported entry type: symlinks are not allowed",
    );
  }
}

/**
 * Validates that a file has a .compact extension.
 */
function validateFileExtension(name: string): void {
  // Strip trailing slashes for directory-like names
  const cleanName = name.replace(/\/+$/, "");
  const ext = extname(cleanName);
  const filename = basename(cleanName);

  if (ext !== ".compact") {
    throw new ArchiveValidationError(
      `Archive contains file with disallowed extension: '${filename}'. Only .compact files are permitted`,
    );
  }
}

/**
 * Extracts a tar.gz archive buffer into the specified directory with full security validation.
 * Returns an array of extracted file paths (relative to extractDir).
 */
export async function extractArchive(archiveBuffer: Buffer, extractDir: string): Promise<string[]> {
  return new Promise<string[]>((resolvePromise, rejectPromise) => {
    let settled = false;
    let totalSize = 0;
    let fileCount = 0;
    const extractedFiles: string[] = [];

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise(extractedFiles);
      }
    };

    // Set up extraction timeout
    const timeoutId = setTimeout(() => {
      settle(new ArchiveValidationError("Archive extraction timed out"));
      // Destroy streams to stop processing
      try {
        gunzip.destroy();
        parser.destroy();
      } catch {
        // Ignore destroy errors
      }
    }, EXTRACTION_TIMEOUT_MS);

    const gunzip = createGunzip();
    const parser = tarExtract();

    parser.on("entry", (header, stream, next) => {
      if (settled) {
        stream.resume();
        next();
        return;
      }

      try {
        const name = header.name;

        // Validate entry name
        validateEntryName(name, extractDir);

        // Validate entry type
        validateEntryType(header.type ?? "file");

        // For files, validate extension
        if (header.type === "file") {
          validateFileExtension(name);

          // Check file count
          fileCount++;
          if (fileCount > MAX_FILE_COUNT) {
            throw new ArchiveValidationError("Archive exceeds maximum file count of 50");
          }
        }
      } catch (err) {
        stream.resume();
        settle(err as Error);
        next();
        return;
      }

      if (header.type === "directory") {
        // Create directory and move on
        const dirPath = resolve(extractDir, normalize(header.name));
        mkdir(dirPath, { recursive: true })
          .then(() => {
            next();
          })
          .catch((err: unknown) => {
            settle(err as Error);
          });
        stream.resume();
        return;
      }

      // Collect file data
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;

        totalSize += chunk.length;
        if (totalSize > MAX_UNCOMPRESSED_SIZE) {
          settle(new ArchiveValidationError("Archive exceeds maximum uncompressed size of 2MB"));
          stream.destroy();
          return;
        }
        chunks.push(chunk);
      });

      stream.on("end", () => {
        if (settled) {
          next();
          return;
        }

        const filePath = resolve(extractDir, normalize(header.name));
        const fileDir = join(filePath, "..");

        mkdir(fileDir, { recursive: true })
          .then(() => writeFile(filePath, Buffer.concat(chunks)))
          .then(() => {
            extractedFiles.push(header.name);
            next();
          })
          .catch((err: unknown) => {
            settle(err as Error);
            next();
          });
      });

      stream.on("error", (err: Error) => {
        settle(err);
        next();
      });
    });

    parser.on("finish", () => {
      if (settled) return;

      if (extractedFiles.length === 0) {
        settle(new ArchiveValidationError("Archive contains no .compact files"));
        return;
      }

      settle();
    });

    parser.on("error", (err: Error) => {
      if (!settled) {
        settle(err);
      }
    });

    gunzip.on("error", (err: Error) => {
      if (!settled) {
        settle(err);
      }
    });

    // Pipe: buffer → gunzip → tar parser
    gunzip.pipe(parser);
    gunzip.end(archiveBuffer);
  });
}
