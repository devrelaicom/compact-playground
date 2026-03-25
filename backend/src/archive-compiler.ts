import { readFile, mkdir, rm } from "fs/promises";
import { join, resolve, sep } from "path";
import { v4 as uuidv4 } from "uuid";
import { validateArchiveFormat, extractArchive, ArchiveValidationError } from "./archive.js";
import { runCompiler, type CompileResult } from "./compiler.js";
import { parseCompilerErrors } from "./parser.js";
import { detectVersionFromPragma } from "./version-manager.js";
import { generateArchiveCacheKey, getFileCache } from "./cache.js";
import { getConfig } from "./config.js";

/**
 * Compiles a multi-file Compact archive and returns the result.
 *
 * The archive must be a gzip-compressed tarball containing .compact files.
 * The entry point file must contain a `pragma language_version` directive
 * so the compiler version can be detected automatically.
 */
export async function compileArchive(
  archiveBuffer: Buffer,
  entryPoint: string,
  options?: { skipZk?: boolean; timeout?: number },
): Promise<{ result: CompileResult; cacheKey?: string }> {
  const config = getConfig();
  const startTime = Date.now();
  const sessionId = uuidv4();
  const extractDir = join(config.tempDir, sessionId);

  try {
    // Step 1: Create extraction directory
    await mkdir(extractDir, { recursive: true });

    // Step 2: Validate archive format
    if (!validateArchiveFormat(archiveBuffer)) {
      throw new ArchiveValidationError("Invalid archive format. Expected a .tar.gz file");
    }

    // Step 3: Extract archive
    await extractArchive(archiveBuffer, extractDir);

    // Step 4: Validate entry point path (path traversal check)
    const entryPointFullPath = resolve(extractDir, entryPoint);
    if (!entryPointFullPath.startsWith(extractDir + sep) && entryPointFullPath !== extractDir) {
      throw new ArchiveValidationError("entryPoint path must not escape the archive root");
    }

    // Step 5: Verify entry point file exists
    let entryPointContent: string;
    try {
      entryPointContent = await readFile(entryPointFullPath, "utf-8");
    } catch {
      throw new ArchiveValidationError(`Entry point '${entryPoint}' not found in archive`);
    }

    // Step 6: Detect compiler version from pragma
    const detectedVersion = await detectVersionFromPragma(entryPointContent);
    if (!detectedVersion) {
      throw new ArchiveValidationError(
        "Could not detect language version from pragma in entry point",
      );
    }

    // Step 7: Check cache
    const cache = getFileCache();
    const cacheKey = cache
      ? generateArchiveCacheKey(archiveBuffer, detectedVersion, {
          skipZk: options?.skipZk,
        })
      : null;

    if (cache && cacheKey) {
      const cached = await cache.get<CompileResult>("compile-archive", cacheKey);
      if (cached) {
        return { result: cached, cacheKey: cache.getPublicIdForKey(cacheKey) };
      }
    }

    // Step 8: Build compiler arguments
    const outputDir = join(extractDir, "__compiler_output__");
    await mkdir(outputDir, { recursive: true });

    const compileArgs: string[] = ["compile", `+${detectedVersion}`];

    if (options?.skipZk !== false) {
      compileArgs.push("--skip-zk");
    }

    compileArgs.push(entryPointFullPath, outputDir);

    // Step 9: Run compiler (clamp timeout to server max)
    const timeout = Math.min(options?.timeout ?? config.compileTimeout, config.compileTimeout);
    const result = await runCompiler(compileArgs, timeout);

    const executionTime = Date.now() - startTime;

    // Step 10: Parse output and build result
    if (result.exitCode === 0) {
      const warnings = parseCompilerErrors(result.stderr);
      const compileResult: CompileResult = {
        success: true,
        compilerVersion: detectedVersion,
        output: "Compilation successful",
        warnings: warnings.length > 0 ? warnings : undefined,
        compiledAt: new Date().toISOString(),
        originalCode: entryPointContent,
        executionTime,
      };

      if (cache && cacheKey) {
        const publicCacheKey = await cache.set("compile-archive", cacheKey, compileResult);
        return { result: compileResult, cacheKey: publicCacheKey };
      }

      return { result: compileResult, cacheKey: undefined };
    } else {
      const errors = parseCompilerErrors(result.stderr || result.stdout);

      return {
        result: {
          success: false,
          compilerVersion: detectedVersion,
          errors:
            errors.length > 0
              ? errors
              : [
                  {
                    message: result.stderr || "Compilation failed",
                    severity: "error",
                  },
                ],
          output: `Compilation failed with ${String(errors.length)} error(s)`,
          compiledAt: new Date().toISOString(),
          originalCode: entryPointContent,
          executionTime,
        },
      };
    }
  } finally {
    // Cleanup temp directory
    try {
      await rm(extractDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
