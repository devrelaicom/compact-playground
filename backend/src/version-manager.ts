import { spawn } from "child_process";
import { getConfig } from "./config.js";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersionString(version: string): ParsedVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

export function isValidVersion(version: string): boolean {
  return parseVersionString(version) !== null;
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersionString(a);
  const vb = parseVersionString(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

export function resolveVersion(
  requested: string,
  installedVersions: string[]
): string | null {
  if (installedVersions.length === 0) return null;

  if (requested === "latest") {
    const sorted = [...installedVersions].sort(compareVersions);
    return sorted[sorted.length - 1];
  }

  if (installedVersions.includes(requested)) {
    return requested;
  }

  return null;
}

/**
 * Discovers installed compiler versions by running `compact list --installed`
 * or by scanning the compact directory.
 */
export async function listInstalledVersions(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn("compact", ["list", "--installed"], { timeout: 5000 });

    let stdout = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        const versions = stdout
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => isValidVersion(line));
        resolve(versions);
      } else {
        resolve([]);
      }
    });

    proc.on("error", () => resolve([]));
  });
}

/**
 * Gets the default compiler version based on config.
 */
export async function getDefaultVersion(): Promise<string | null> {
  const config = getConfig();
  const requested = config.defaultCompilerVersion;

  if (requested !== "latest" && isValidVersion(requested)) {
    return requested;
  }

  const installed = await listInstalledVersions();
  return resolveVersion("latest", installed);
}
