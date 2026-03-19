import { spawn } from "child_process";
import { mkdir, writeFile, rm, readdir, readFile } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { wrapWithDefaults, hasPragma, getWrapperLineOffset } from "./wrapper.js";
import {
  parseCompilerErrors,
  CompilerError,
  parseCompilerInsights,
  CompilerInsights,
} from "./parser.js";
import { getConfig } from "./config.js";
import { getDefaultVersion, getCompilerLanguageVersion } from "./version-manager.js";
import { getFileCache, generateCacheKey } from "./cache.js";
import { linkLibraries } from "./libraries.js";

export interface CompileOptions {
  wrapWithDefaults?: boolean;
  languageVersion?: string;
  skipZk?: boolean;
  timeout?: number;
  version?: string;
  includeBindings?: boolean;
  libraries?: string[];
}

export interface CompileResult {
  success: boolean;
  compilerVersion?: string;
  requestedVersion?: string;
  output?: string;
  errors?: CompilerError[];
  warnings?: CompilerError[];
  compiledAt: string;
  originalCode?: string;
  wrappedCode?: string;
  executionTime?: number;
  bindings?: Record<string, string>;
  insights?: CompilerInsights;
}

/**
 * Compiles Compact code and returns the result
 */
export async function compile(
  code: string,
  options: CompileOptions = {},
): Promise<{ result: CompileResult; cacheKey?: string }> {
  const config = getConfig();
  const startTime = Date.now();
  const sessionId = uuidv4();
  const sessionDir = join(config.tempDir, sessionId);

  try {
    // Create temp directory for this compilation
    await mkdir(sessionDir, { recursive: true });

    // Resolve the compiler version (explicit or default) once
    const compilerVersion = options.version || (await getDefaultVersion());

    // Check cache before doing any work
    const cache = getFileCache();
    const cacheKey = cache
      ? generateCacheKey(code, compilerVersion || "default", {
          wrapWithDefaults: options.wrapWithDefaults,
          skipZk: options.skipZk,
          includeBindings: options.includeBindings,
          libraries: options.libraries,
        })
      : null;

    if (cache && cacheKey) {
      const cached = await cache.get<CompileResult>("compile", cacheKey);
      if (cached) {
        return { result: cached, cacheKey };
      }
    }

    // Determine if we need to wrap the code
    let finalCode = code;
    const needsWrapping = options.wrapWithDefaults !== false && !hasPragma(code);

    if (needsWrapping) {
      // Dynamically resolve language version from the compiler that will be used
      let languageVersion = options.languageVersion;
      if (!languageVersion && compilerVersion) {
        try {
          languageVersion = await getCompilerLanguageVersion(compilerVersion);
        } catch {
          // Fall back to DEFAULT_MIN_VERSION in wrapper
        }
      }
      finalCode = wrapWithDefaults(code, languageVersion);
    }

    // Write the code to a temp file
    const sourceFile = join(sessionDir, "contract.compact");
    const outputDir = join(sessionDir, "output");
    await writeFile(sourceFile, finalCode, "utf-8");
    await mkdir(outputDir, { recursive: true });

    // Link OZ library modules into the compilation directory if requested
    if (options.libraries && options.libraries.length > 0) {
      await linkLibraries(options.libraries, sessionDir);
    }

    // Run the compiler via `compact compile [+VERSION] [FLAGS] <source> <output>`
    const compileArgs: string[] = ["compile"];

    // Always use explicit +VERSION to avoid reliance on CLI default
    if (compilerVersion) {
      compileArgs.push(`+${compilerVersion}`);
    }

    // When includeBindings is requested, we need full compilation (not --skip-zk)
    // because --skip-zk only checks syntax and doesn't produce output artifacts
    const effectiveSkipZk = options.includeBindings ? false : options.skipZk;

    // Use --skip-zk for faster compilation (syntax checking only)
    if (effectiveSkipZk !== false) {
      compileArgs.push("--skip-zk");
    }

    compileArgs.push(sourceFile, outputDir);

    const result = await runCompiler(compileArgs, options.timeout || config.compileTimeout);

    const executionTime = Date.now() - startTime;

    if (result.exitCode === 0) {
      // Success
      const warnings = parseCompilerErrors(result.stderr);

      // Collect TypeScript bindings if requested
      let bindings: Record<string, string> | undefined;
      if (options.includeBindings) {
        const collected = await collectBindings(outputDir);
        if (Object.keys(collected).length > 0) {
          bindings = collected;
        }
      }

      // Parse compilation insights from compiler output
      const insights = parseCompilerInsights(result.stderr) ?? undefined;

      const compileResult: CompileResult = {
        success: true,
        compilerVersion: compilerVersion ?? undefined,
        output: "Compilation successful",
        warnings: warnings.length > 0 ? warnings : undefined,
        compiledAt: new Date().toISOString(),
        originalCode: needsWrapping ? code : undefined,
        wrappedCode: needsWrapping ? finalCode : undefined,
        executionTime,
        bindings,
        insights,
      };

      if (cache && cacheKey) {
        await cache.set("compile", cacheKey, compileResult);
      }

      return { result: compileResult, cacheKey: cacheKey ?? undefined };
    } else {
      // Compilation failed
      const errors = parseCompilerErrors(result.stderr || result.stdout);

      // Adjust line numbers if code was wrapped
      if (needsWrapping && errors.length > 0) {
        const wrapperLines = getWrapperLineOffset(code);
        errors.forEach((error) => {
          if (error.line && error.line > wrapperLines) {
            error.line -= wrapperLines;
          }
        });
      }

      return {
        result: {
          success: false,
          compilerVersion: compilerVersion ?? undefined,
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
          originalCode: needsWrapping ? code : undefined,
          wrappedCode: needsWrapping ? finalCode : undefined,
          executionTime,
        },
      };
    }
  } finally {
    // Cleanup temp directory
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Reads all .ts files from the compiler output directory
 */
async function collectBindings(outputDir: string): Promise<Record<string, string>> {
  const bindings: Record<string, string> = {};
  try {
    const entries = await readdir(outputDir, { recursive: true });
    for (const entry of entries) {
      if (entry.endsWith(".ts")) {
        const content = await readFile(join(outputDir, entry), "utf-8");
        bindings[entry] = content;
      }
    }
  } catch {
    // Output directory may not exist or be empty
  }
  return bindings;
}

interface CompilerOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the compact compiler with the given arguments
 */
export async function runCompiler(args: string[], timeout: number): Promise<CompilerOutput> {
  return new Promise((resolve, reject) => {
    const compactCli = getConfig().compactCliPath;

    const proc = spawn(compactCli, args, {
      env: {
        ...process.env,
        // Ensure TERM is set for proper output
        TERM: "dumb",
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        // Escalate to SIGKILL if the process doesn't exit within 2 seconds
        killTimer = setTimeout(() => proc.kill("SIGKILL"), 2000);
        reject(new Error("Compilation timed out"));
      }
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      if (!settled) {
        settled = true;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("Compact CLI not found. Please ensure it is installed and in PATH."));
        } else {
          reject(error);
        }
      }
    });
  });
}
