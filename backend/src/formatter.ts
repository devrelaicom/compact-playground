import { spawn } from "child_process";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "./config.js";

export interface FormatOptions {
  diff?: boolean;
  timeout?: number;
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

    const formatterPath = process.env.FORMAT_COMPACT_PATH || "format-compact";
    const result = await runFormatter(
      formatterPath,
      [sourceFile],
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

    if (options.diff && changed) {
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
      timeout,
      env: { ...process.env, TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("format-compact not found. Ensure it is installed and in PATH."));
      } else {
        reject(error);
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
