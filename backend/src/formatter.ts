import { spawn } from "child_process";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "./config.js";
import { getDefaultVersion, ensureVersion } from "./version-manager.js";

export interface FormatOptions {
  diff?: boolean;
  timeout?: number;
  version?: string;
}

export interface FormatResult {
  success: boolean;
  formatted?: string;
  changed?: boolean;
  diff?: string;
  error?: string;
}

export async function formatCode(
  code: string,
  options: FormatOptions = {}
): Promise<FormatResult> {
  if (!code || !code.trim()) {
    return { success: false, error: "No code to format" };
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

    // Resolve the version to use (explicit or default)
    const version = options.version || (await getDefaultVersion());

    // Ensure the version is installed (cached across requests)
    let versionDir: string | null = null;
    if (version) {
      try {
        versionDir = await ensureVersion(version);
      } catch (err) {
        return {
          success: false,
          error: `Failed to ensure version ${version}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Build format args — use --directory when we have a version dir
    const formatArgs = versionDir
      ? ["format", "--directory", versionDir, sourceFile]
      : ["format", sourceFile];

    const result = await runFormatter(
      compactCli,
      formatArgs,
      options.timeout || 10000
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || "Formatting failed",
      };
    }

    const formatted = await readFile(sourceFile, "utf-8");
    const changed = formatted !== code;

    const formatResult: FormatResult = {
      success: true,
      formatted,
      changed,
    };

    if (changed) {
      formatResult.diff = generateSimpleDiff(code, formatted);
    }

    return formatResult;
  } finally {
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

function runFormatter(
  path: string,
  args: string[],
  timeout: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(path, args, {
      env: { ...process.env, TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("Formatting timed out"));
      }
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
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
    const orig = origLines[i];
    const fmt = fmtLines[i];

    if (orig === undefined) {
      diff.push(`+ ${fmt}`);
    } else if (fmt === undefined) {
      diff.push(`- ${orig}`);
    } else if (orig !== fmt) {
      diff.push(`- ${orig}`);
      diff.push(`+ ${fmt}`);
    }
  }

  return diff.join("\n");
}
