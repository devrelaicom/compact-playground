import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateArchiveFormat,
  extractArchive,
  ArchiveValidationError,
} from "../backend/src/archive.js";
import tar from "tar-stream";
import { createGzip } from "zlib";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

interface TestEntry {
  name: string;
  content?: string;
  type?: string;
}

async function createTestArchive(entries: TestEntry[]): Promise<Buffer> {
  const pack = tar.pack();
  for (const entry of entries) {
    if (entry.type === "directory") {
      pack.entry({ name: entry.name, type: "directory" });
    } else if (entry.type === "symlink") {
      pack.entry({
        name: entry.name,
        type: "symlink",
        linkname: entry.content ?? "target",
      } as tar.Headers);
    } else {
      pack.entry(
        { name: entry.name, type: (entry.type as tar.Headers["type"]) ?? "file" },
        entry.content ?? "",
      );
    }
  }
  pack.finalize();

  const chunks: Buffer[] = [];
  const gzip = createGzip();
  pack.pipe(gzip);
  for await (const chunk of gzip) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

let tempDir: string;

describe("archive", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "archive-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("validateArchiveFormat", () => {
    it("accepts valid gzip magic bytes", async () => {
      const archive = await createTestArchive([{ name: "hello.compact", content: "hello" }]);
      expect(validateArchiveFormat(archive)).toBe(true);
    });

    it("rejects invalid magic bytes", () => {
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
      expect(validateArchiveFormat(buf)).toBe(false);
    });

    it("rejects empty buffer", () => {
      expect(validateArchiveFormat(Buffer.alloc(0))).toBe(false);
    });

    it("rejects single-byte buffer", () => {
      expect(validateArchiveFormat(Buffer.from([0x1f]))).toBe(false);
    });
  });

  describe("path traversal attacks", () => {
    it("rejects entry with ../../etc/passwd", async () => {
      const archive = await createTestArchive([
        { name: "../../etc/passwd", content: "root:x:0:0" },
      ]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "entry attempts to escape extraction directory",
      );
    });

    it("rejects absolute paths", async () => {
      const archive = await createTestArchive([{ name: "/etc/passwd", content: "root:x:0:0" }]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "entry attempts to escape extraction directory",
      );
    });

    it("rejects entries with .. segments", async () => {
      const archive = await createTestArchive([
        { name: "foo/../../../bar.compact", content: "data" },
      ]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "entry attempts to escape extraction directory",
      );
    });

    it("rejects filenames with null bytes", async () => {
      // tar-stream may strip null bytes, so we craft the archive manually
      // to inject a null byte into the header name field
      const pack = tar.pack();
      const nameWithNull = "hello\0.compact";
      // Manually push an entry whose name contains a null byte
      pack.entry({ name: nameWithNull, type: "file" }, "data");
      pack.finalize();

      const chunks: Buffer[] = [];
      const gzip = createGzip();
      pack.pipe(gzip);
      for await (const chunk of gzip) {
        chunks.push(chunk as Buffer);
      }
      const archive = Buffer.concat(chunks);

      // The archive module should reject this — either due to the null byte
      // triggering path validation or the extension check on the truncated name
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
    });
  });

  describe("symlink rejection", () => {
    it("rejects tar with symlink entry", async () => {
      const archive = await createTestArchive([
        { name: "link.compact", type: "symlink", content: "/etc/passwd" },
      ]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow("symlinks are not allowed");
    });
  });

  describe("extension filtering", () => {
    it("rejects archive with .js file", async () => {
      const archive = await createTestArchive([{ name: "foo.js", content: "console.log('hi')" }]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "Archive contains file with disallowed extension: 'foo.js'. Only .compact files are permitted",
      );
    });

    it("accepts archive with only .compact files", async () => {
      const archive = await createTestArchive([
        { name: "main.compact", content: "circuit main() {}" },
      ]);

      const files = await extractArchive(archive, tempDir);
      expect(files).toContain("main.compact");
    });
  });

  describe("size limits", () => {
    it("rejects archive expanding beyond 2 MB", async () => {
      // Create content slightly over 2MB
      const largeContent = "x".repeat(2 * 1024 * 1024 + 1);
      const archive = await createTestArchive([{ name: "big.compact", content: largeContent }]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "Archive exceeds maximum uncompressed size of 2MB",
      );
    });
  });

  describe("file count limits", () => {
    it("rejects archive with 51+ files", async () => {
      const entries: TestEntry[] = [];
      for (let i = 0; i < 51; i++) {
        entries.push({ name: `file${String(i)}.compact`, content: `content ${String(i)}` });
      }
      const archive = await createTestArchive(entries);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "Archive exceeds maximum file count of 50",
      );
    });
  });

  describe("empty archive", () => {
    it("rejects archive with no .compact files", async () => {
      // Create an archive with only a directory entry (no files)
      const archive = await createTestArchive([{ name: "src/", type: "directory" }]);

      await expect(extractArchive(archive, tempDir)).rejects.toThrow(ArchiveValidationError);
      await expect(extractArchive(archive, tempDir)).rejects.toThrow(
        "Archive contains no .compact files",
      );
    });
  });

  describe("happy path", () => {
    it("extracts valid archive with nested directories correctly", async () => {
      const archive = await createTestArchive([
        { name: "src/", type: "directory" },
        { name: "src/main.compact", content: "circuit main() {}" },
        { name: "src/utils/", type: "directory" },
        { name: "src/utils/helper.compact", content: "circuit helper() {}" },
        { name: "lib.compact", content: "circuit lib() {}" },
      ]);

      const files = await extractArchive(archive, tempDir);

      expect(files).toHaveLength(3);
      expect(files).toContain("src/main.compact");
      expect(files).toContain("src/utils/helper.compact");
      expect(files).toContain("lib.compact");

      // Verify files were written to correct paths with correct content
      const mainContent = await readFile(join(tempDir, "src/main.compact"), "utf-8");
      expect(mainContent).toBe("circuit main() {}");

      const helperContent = await readFile(join(tempDir, "src/utils/helper.compact"), "utf-8");
      expect(helperContent).toBe("circuit helper() {}");

      const libContent = await readFile(join(tempDir, "lib.compact"), "utf-8");
      expect(libContent).toBe("circuit lib() {}");
    });
  });
});
