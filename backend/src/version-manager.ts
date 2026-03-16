import { spawn } from "child_process";
import { mkdir, symlink, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
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

export function resolveVersion(requested: string, installedVersions: string[]): string | null {
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

// Cache for listInstalledVersions to avoid repeated subprocess spawns
let installedVersionsCache: { versions: string[]; timestamp: number } | null = null;
const INSTALLED_VERSIONS_TTL = 30_000; // 30 seconds

/**
 * Discovers installed compiler versions by running `compact list --installed`
 * or by scanning the compact directory. Results are cached for 30 seconds.
 */
export async function listInstalledVersions(): Promise<string[]> {
  if (
    installedVersionsCache &&
    Date.now() - installedVersionsCache.timestamp < INSTALLED_VERSIONS_TTL
  ) {
    return installedVersionsCache.versions;
  }

  return new Promise((resolve) => {
    const compactCli = getConfig().compactCliPath;
    const proc = spawn(compactCli, ["list", "--installed"], { timeout: 5000 });

    let stdout = "";
    proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        const versions = stdout
          .trim()
          .split("\n")
          .map((line) => {
            // Strip leading markers (e.g. "→ ") and whitespace
            const match = line.match(/(\d+\.\d+\.\d+)/);
            return match ? match[1] : "";
          })
          .filter((line) => isValidVersion(line));
        installedVersionsCache = { versions, timestamp: Date.now() };
        resolve(versions);
      } else {
        resolve([]);
      }
    });

    proc.on("error", () => {
      resolve([]);
    });
  });
}

/**
 * Gets the default compiler version based on config.
 */
export async function getDefaultVersion(): Promise<string | null> {
  const config = getConfig();
  const requested = config.defaultCompilerVersion;
  const installed = await listInstalledVersions();

  if (requested !== "latest" && isValidVersion(requested)) {
    if (!installed.includes(requested)) {
      console.warn(
        `Configured default version ${requested} is not installed, falling back to latest`,
      );
      return resolveVersion("latest", installed);
    }
    return requested;
  }

  return resolveVersion("latest", installed);
}

// Cache of compiler version → language version mappings
const languageVersionCache = new Map<string, string>();

/**
 * Gets the language version for a specific compiler version.
 * Runs `compact compile +VERSION --language-version` and caches the result.
 */
export async function getCompilerLanguageVersion(compilerVersion: string): Promise<string> {
  const cached = languageVersionCache.get(compilerVersion);
  if (cached) return cached;

  return new Promise((resolve, reject) => {
    const compactCli = getConfig().compactCliPath;
    const proc = spawn(compactCli, ["compile", `+${compilerVersion}`, "--language-version"], {
      timeout: 10000,
      env: { ...process.env, TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
    proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));

    proc.on("close", (code: number | null) => {
      if (code === 0 && stdout.trim()) {
        // Older compilers may output extra lines (e.g. "Compactc version: 0.24.0\n0.16.0").
        // Extract the last line that looks like a semver version.
        const lines = stdout.trim().split("\n");
        const langVersion = lines
          .map((l) => l.trim())
          .filter((l) => /^\d+\.\d+\.\d+$/.test(l))
          .pop();
        if (!langVersion) {
          reject(
            new Error(
              `Could not parse language version from compiler ${compilerVersion} output: ${stdout.trim()}`,
            ),
          );
          return;
        }
        languageVersionCache.set(compilerVersion, langVersion);
        resolve(langVersion);
      } else {
        reject(
          new Error(`Failed to get language version for compiler ${compilerVersion}: ${stderr}`),
        );
      }
    });

    proc.on("error", (error: Error) => {
      reject(new Error(`Failed to run compact compile: ${error.message}`));
    });
  });
}

/**
 * Builds a map of compiler version → language version for all installed compilers.
 */
export async function buildLanguageVersionMap(): Promise<Map<string, string>> {
  const installed = await listInstalledVersions();
  const map = new Map<string, string>();

  // Run sequentially to avoid OOM — each compiler process uses ~180MB
  for (const version of installed) {
    try {
      const langVersion = await getCompilerLanguageVersion(version);
      map.set(version, langVersion);
    } catch {
      // Skip versions that fail
    }
  }

  return map;
}

/**
 * Detects the best compiler version from a pragma in the source code.
 * Parses pragma constraints and finds the newest installed compiler whose
 * language version satisfies them.
 */
export async function detectVersionFromPragma(code: string): Promise<string | null> {
  const pragmaMatch = code.match(/pragma\s+language_version\s+(.+?);/);
  if (!pragmaMatch) return null;

  const constraint = pragmaMatch[1].trim();
  const langMap = await buildLanguageVersionMap();

  // Parse constraint parts (e.g. ">= 0.16 && <= 0.18" or ">= 0.21")
  const parts = constraint.split("&&").map((p) => p.trim());

  const matchingCompilers: string[] = [];

  for (const [compilerVersion, langVersion] of langMap) {
    const parsed = parseVersionString(langVersion);
    if (!parsed) continue;

    let satisfies = true;
    for (const part of parts) {
      const opMatch = part.match(/^(>=|<=|>|<|=)\s*(\d+\.\d+(?:\.\d+)?)$/);
      if (!opMatch) {
        satisfies = false;
        break;
      }
      const [, op, ver] = opMatch;
      // Normalize to 3-part version for comparison
      const target = ver.includes(".")
        ? ver.split(".").length === 2
          ? `${ver}.0`
          : ver
        : `${ver}.0.0`;
      const cmp = compareVersions(
        langVersion.split(".").length === 2 ? `${langVersion}.0` : langVersion,
        target,
      );

      switch (op) {
        case ">=":
          if (cmp < 0) satisfies = false;
          break;
        case "<=":
          if (cmp > 0) satisfies = false;
          break;
        case ">":
          if (cmp <= 0) satisfies = false;
          break;
        case "<":
          if (cmp >= 0) satisfies = false;
          break;
        case "=":
          if (cmp !== 0) satisfies = false;
          break;
      }
    }

    if (satisfies) {
      matchingCompilers.push(compilerVersion);
    }
  }

  if (matchingCompilers.length === 0) return null;

  // Return the newest matching compiler
  matchingCompilers.sort(compareVersions);
  return matchingCompilers[matchingCompilers.length - 1];
}

/**
 * Resolves a version string that may be "latest", "detect", or a specific version.
 * - "latest" → resolves to the newest installed compiler
 * - "detect" → parses pragma from code to find a compatible compiler, falls back to default
 * - specific version → returned as-is
 */
export async function resolveRequestedVersion(version: string, code: string): Promise<string> {
  if (version === "latest") {
    const installed = await listInstalledVersions();
    const resolved = resolveVersion("latest", installed);
    if (!resolved) throw new Error("No installed compiler versions found");
    return resolved;
  }

  if (version === "detect") {
    const detected = await detectVersionFromPragma(code);
    if (detected) return detected;
    // Fall back to default
    const defaultVer = await getDefaultVersion();
    if (!defaultVer) throw new Error("No installed compiler versions found");
    return defaultVer;
  }

  if (!isValidVersion(version)) {
    throw new Error(`Invalid version format: ${version}. Expected semver like "0.29.0"`);
  }

  // Verify the version is actually installed
  const installed = await listInstalledVersions();
  if (!installed.includes(version)) {
    throw new Error(
      `Version ${version} is not installed. Available versions: ${installed.join(", ") || "none"}`,
    );
  }

  return version;
}

/** Reset language version cache (for testing) */
export function resetLanguageVersionCache(): void {
  languageVersionCache.clear();
  installedVersionsCache = null;
}

// Cache of versions that have been ensured (installed to their isolated directory)
const ensuredVersions = new Set<string>();

// In-flight install promises to prevent concurrent installs of the same version
const inFlightInstalls = new Map<string, Promise<string>>();

/**
 * Prepares an isolated --directory for a specific compiler version.
 * Runs `compact update VERSION --directory DIR` to select the version;
 * this is a local operation when the version is already installed globally.
 * Results are cached so subsequent calls return immediately.
 * Deduplicates concurrent requests for the same version.
 * Returns the directory path for the version.
 */
export async function prepareVersionDir(version: string): Promise<string> {
  const config = getConfig();
  const versionDir = join(config.tempDir, `compact-versions`, version);

  if (ensuredVersions.has(version)) {
    return versionDir;
  }

  // Dedupe concurrent installs of the same version
  const existing = inFlightInstalls.get(version);
  if (existing) {
    return existing;
  }

  const installPromise = doInstall(version, versionDir, config).finally(() => {
    inFlightInstalls.delete(version);
  });

  inFlightInstalls.set(version, installPromise);
  return installPromise;
}

async function doInstall(
  version: string,
  versionDir: string,
  config: ReturnType<typeof getConfig>,
): Promise<string> {
  // Create the versions subdirectory inside the per-version compact home
  const versionsSubdir = join(versionDir, "versions");
  await mkdir(versionsSubdir, { recursive: true });

  // Symlink the version's binaries from the global compact home so that
  // `compact update --directory` can find them. The global home is either
  // COMPACT_DIRECTORY (if set) or ~/.compact.
  const globalHome = process.env.COMPACT_DIRECTORY || join(homedir(), ".compact");
  const globalVersionDir = join(globalHome, "versions", version);
  const localVersionDir = join(versionsSubdir, version);

  try {
    await stat(localVersionDir);
  } catch {
    try {
      await stat(globalVersionDir);
      await symlink(globalVersionDir, localVersionDir);
    } catch {
      // Global version dir doesn't exist — compact update will attempt to download
    }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(config.compactCliPath, ["update", version, "--directory", versionDir], {
      timeout: 120000,
      env: { ...process.env, TERM: "dumb" },
    });

    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        ensuredVersions.add(version);
        resolve(versionDir);
      } else {
        reject(new Error(`Failed to install compiler version ${version}: ${stderr}`));
      }
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to run compact update: ${error.message}`));
    });
  });
}

/** Reset ensured versions cache (for testing) */
export function resetPreparedVersionDirs(): void {
  ensuredVersions.clear();
}
