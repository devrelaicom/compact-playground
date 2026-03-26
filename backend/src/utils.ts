import { spawn } from "child_process";

/**
 * Checks if the Compact compiler is installed and accessible
 */
export async function isCompilerInstalled(): Promise<boolean> {
  try {
    const version = await getCompilerVersion();
    return version !== null;
  } catch {
    return false;
  }
}

/**
 * Gets the version of the installed Compact compiler
 */
export async function getCompilerVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    // Use compactc directly (the actual compiler binary)
    const compilerPath = process.env.COMPACT_PATH || "compactc";

    const proc = spawn(compilerPath, ["--version"], {
      timeout: 5000,
    });

    let stdout = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout) {
        // Extract version number from output
        const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
        resolve(versionMatch ? versionMatch[1] : stdout.trim());
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
}