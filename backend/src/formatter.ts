import { spawn } from "child_process";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "./config.js";
import { getDefaultVersion, prepareVersionDir } from "./version-manager.js";
import { getFileCache, generateCacheKey } from "./cache.js";
import type { FormatterError } from "./types.js";
import { acquireExecutionSlot, releaseExecutionSlot } from "./execution-limiter.js";

export interface FormatOptions {
  timeout?: number;
  version?: string;
}

export interface FormatResult {
  success: boolean;
  compilerVersion?: string;
  requestedVersion?: string;
  formatted?: string;
  changed?: boolean;
  diff?: string;
  errors?: FormatterError[];
}

export async function formatCode(
  code: string,
  options: FormatOptions = {},
): Promise<{ result: FormatResult; cacheKey?: string }> {
  if (!code || !code.trim()) {
    return {
      result: {
        success: false,
        errors: [{ message: "No code to format", severity: "error" }],
      },
    };
  }

  // Check file cache
  const cache = getFileCache();
  const version = options.version || (await getDefaultVersion());
  const cacheKey = cache ? generateCacheKey(code, version || "default", {}) : null;

  if (cache && cacheKey) {
    const cached = await cache.get<FormatResult>("format", cacheKey);
    if (cached) {
      return { result: cached, cacheKey: cache.getPublicIdForKey(cacheKey) };
    }
  }

  const config = getConfig();
  const sessionId = uuidv4();
  const sessionDir = join(config.tempDir, `fmt-${sessionId}`);

  try {
    await mkdir(sessionDir, { recursive: true });

    const sourceFile = join(sessionDir, "contract.compact");
    await writeFile(sourceFile, code, "utf-8");

    // Use `compact format <file>`
    const compactCli = config.compactCliPath;

    // Set up an isolated --directory for this version. compact update is used
    // to select the version within the directory; it does not download if the
    // version is already installed globally. The result is cached so subsequent
    // requests skip the update call entirely.
    let versionDir: string | null = null;
    if (version) {
      try {
        versionDir = await prepareVersionDir(version);
      } catch (err) {
        return {
          result: {
            success: false,
            compilerVersion: version || undefined,
            errors: [
              {
                message: `Version ${version} is not available: ${err instanceof Error ? err.message : String(err)}`,
                severity: "error",
              },
            ],
          },
        };
      }
    }

    // Build format args — use --directory when we have a version dir
    const formatArgs = versionDir
      ? ["format", "--directory", versionDir, sourceFile]
      : ["format", sourceFile];

    const timeout = Math.min(options.timeout ?? config.formatTimeout, config.formatTimeout);
    const result = await runFormatter(compactCli, formatArgs, timeout);

    if (result.exitCode !== 0) {
      return {
        result: {
          success: false,
          compilerVersion: version || undefined,
          errors: [{ message: result.stderr || "Formatting failed", severity: "error" }],
        },
      };
    }

    const formatted = await readFile(sourceFile, "utf-8");
    const changed = formatted !== code;

    const formatResult: FormatResult = {
      success: true,
      compilerVersion: version || undefined,
      formatted,
      changed,
    };

    if (changed) {
      formatResult.diff = generateSimpleDiff(code, formatted);
    }

    if (cache && cacheKey) {
      const publicCacheKey = await cache.set("format", cacheKey, formatResult);
      return { result: formatResult, cacheKey: publicCacheKey };
    }

    return { result: formatResult, cacheKey: undefined };
  } finally {
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function runFormatter(
  path: string,
  args: string[],
  timeout: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  await acquireExecutionSlot();

  return new Promise((resolve, reject) => {
    let slotReleased = false;
    const releaseSlot = () => {
      if (!slotReleased) {
        slotReleased = true;
        releaseExecutionSlot();
      }
    };

    const proc = spawn(path, args, {
      env: { ...process.env, TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
    proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        // Escalate to SIGKILL if the process doesn't exit within 2 seconds
        killTimer = setTimeout(() => proc.kill("SIGKILL"), 2000);
        reject(new Error("Formatting timed out"));
      }
    }, timeout);

    proc.on("close", (code) => {
      releaseSlot();
      clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      if (!settled) {
        settled = true;
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    proc.on("error", (error) => {
      releaseSlot();
      clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      if (!settled) {
        settled = true;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("compact CLI not found. Ensure it is installed and in PATH."));
        } else {
          reject(error);
        }
      }
    });
  });
}

/** Generate a simple line-by-line diff */
function generateSimpleDiff(original: string, formatted: string): string {
  const origLines = original.split("\n");
  const fmtLines = formatted.split("\n");
  const diff: string[] = [];

  const maxLen = Math.max(origLines.length, fmtLines.length);
  for (let i = 0; i < maxLen; i++) {
    const hasOrig = i < origLines.length;
    const hasFmt = i < fmtLines.length;

    if (!hasOrig) {
      diff.push(`+ ${fmtLines[i]}`);
    } else if (!hasFmt) {
      diff.push(`- ${origLines[i]}`);
    } else if (origLines[i] !== fmtLines[i]) {
      diff.push(`- ${origLines[i]}`);
      diff.push(`+ ${fmtLines[i]}`);
    }
  }

  return diff.join("\n");
}
