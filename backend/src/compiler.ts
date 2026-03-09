import { spawn } from "child_process";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { wrapWithDefaults, hasPragma } from "./wrapper.js";
import { parseCompilerErrors, CompilerError } from "./parser.js";
import { getConfig } from "./config.js";

export interface CompileOptions {
  wrapWithDefaults?: boolean;
  languageVersion?: string;
  skipZk?: boolean;
  timeout?: number;
}

export interface CompileResult {
  success: boolean;
  output?: string;
  errors?: CompilerError[];
  warnings?: CompilerError[];
  compiledAt: string;
  originalCode?: string;
  wrappedCode?: string;
  executionTime?: number;
}

/**
 * Compiles Compact code and returns the result
 */
export async function compile(
  code: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const config = getConfig();
  const startTime = Date.now();
  const sessionId = uuidv4();
  const sessionDir = join(config.tempDir, sessionId);

  try {
    // Create temp directory for this compilation
    await mkdir(sessionDir, { recursive: true });

    // Determine if we need to wrap the code
    let finalCode = code;
    const needsWrapping =
      options.wrapWithDefaults !== false && !hasPragma(code);

    if (needsWrapping) {
      finalCode = wrapWithDefaults(code, options.languageVersion);
    }

    // Write the code to a temp file
    const sourceFile = join(sessionDir, "contract.compact");
    const outputDir = join(sessionDir, "output");
    await writeFile(sourceFile, finalCode, "utf-8");
    await mkdir(outputDir, { recursive: true });

    // Run the compiler
    // compactc takes: [flags] <source-file> <output-dir>
    const compileArgs: string[] = [];

    // Use --skip-zk for faster compilation (syntax checking only)
    if (options.skipZk !== false) {
      compileArgs.push("--skip-zk");
    }

    compileArgs.push(sourceFile, outputDir);

    const result = await runCompiler(
      compileArgs,
      options.timeout || config.compileTimeout
    );

    const executionTime = Date.now() - startTime;

    if (result.exitCode === 0) {
      // Success
      const warnings = parseCompilerErrors(result.stderr);
      return {
        success: true,
        output: "Compilation successful",
        warnings: warnings.length > 0 ? warnings : undefined,
        compiledAt: new Date().toISOString(),
        originalCode: needsWrapping ? code : undefined,
        wrappedCode: needsWrapping ? finalCode : undefined,
        executionTime,
      };
    } else {
      // Compilation failed
      const errors = parseCompilerErrors(result.stderr || result.stdout);

      // Adjust line numbers if code was wrapped
      if (needsWrapping && errors.length > 0) {
        // The wrapper adds 4 lines before user code
        const wrapperLines = 4;
        errors.forEach((error) => {
          if (error.line && error.line > wrapperLines) {
            error.line -= wrapperLines;
          }
        });
      }

      return {
        success: false,
        errors:
          errors.length > 0
            ? errors
            : [
                {
                  message: result.stderr || "Compilation failed",
                  severity: "error",
                },
              ],
        output: `Compilation failed with ${errors.length} error(s)`,
        compiledAt: new Date().toISOString(),
        originalCode: needsWrapping ? code : undefined,
        wrappedCode: needsWrapping ? finalCode : undefined,
        executionTime,
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

interface CompilerOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the compact compiler with the given arguments
 */
async function runCompiler(
  args: string[],
  timeout: number
): Promise<CompilerOutput> {
  return new Promise((resolve, reject) => {
    const compilerPath = getConfig().compilerPath;

    const proc = spawn(compilerPath, args, {
      timeout,
      env: {
        ...process.env,
        // Ensure TERM is set for proper output
        TERM: "dumb",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Compilation timed out"));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "Compact compiler (compactc) not found. Please ensure it is installed and in PATH."
          )
        );
      } else {
        reject(error);
      }
    });
  });
}
