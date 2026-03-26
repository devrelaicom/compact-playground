import { spawn } from "child_process";
import { getConfig } from "./config.js";

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
 * Gets the version of the installed Compact CLI
 */
export async function getCompilerVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const compactCli = getConfig().compactCliPath;

    const proc = spawn(compactCli, ["--version"], {
      timeout: 5000,
    });

    let stdout = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout) {
        // Expected format: "compact 0.4.0"
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
