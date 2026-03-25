import { existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { getCompilerVersion } from "../utils.js";
import {
  listInstalledVersions,
  getDefaultVersion,
  buildLanguageVersionMap,
  resolveVersion,
} from "../version-manager.js";
import { getConfig } from "../config.js";
import { getFileCache } from "../cache.js";
import { listAvailableLibraries } from "../libraries.js";

const healthRoutes = new Hono();

// Pre-computed versions response, populated at startup via warmVersionsCache()
let cachedVersionsResponse: {
  default: string | null;
  installed: { version: string; languageVersion: string }[];
} | null = null;

/**
 * Builds the versions response once at startup so /versions can serve it
 * without spawning any subprocesses.
 */
export async function warmVersionsCache(): Promise<void> {
  const installed = await listInstalledVersions();
  const defaultVersion = resolveVersion("latest", installed);

  let langMap: Map<string, string>;
  try {
    langMap = await buildLanguageVersionMap();
  } catch {
    langMap = new Map();
  }

  cachedVersionsResponse = {
    default: defaultVersion,
    installed: installed.map((version) => ({
      version,
      languageVersion: langMap.get(version) || "unknown",
    })),
  };
}

healthRoutes.get("/health", async (c) => {
  const cliVersion = await getCompilerVersion();
  const cliInstalled = cliVersion !== null;

  const config = getConfig();
  const installed = await listInstalledVersions();
  const defaultVersion = await getDefaultVersion();

  // Check if configured default version is actually available
  const configuredDefault = config.defaultCompilerVersion;
  const defaultVersionValid =
    configuredDefault === "latest" ? installed.length > 0 : installed.includes(configuredDefault);

  const fileCache = getFileCache();
  const cacheStats = fileCache ? fileCache.stats() : null;

  const ozContractsInstalled = existsSync(config.ozContractsPath);
  const ozSimulatorInstalled = existsSync(config.ozSimulatorPath);

  return c.json({
    status: cliInstalled && defaultVersionValid ? "healthy" : "degraded",
    compactCli: {
      installed: cliInstalled,
      version: cliVersion,
    },
    defaultVersion: {
      configured: configuredDefault,
      resolved: defaultVersion,
      valid: defaultVersionValid,
    },
    cache: cacheStats,
    ozDependencies: {
      contracts: {
        installed: ozContractsInstalled,
        path: config.ozContractsPath,
      },
      simulator: {
        installed: ozSimulatorInstalled,
        path: config.ozSimulatorPath,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/versions", (c) => {
  if (!cachedVersionsResponse) {
    return c.json({ error: "Version information not yet available" }, 503);
  }
  return c.json(cachedVersionsResponse);
});

healthRoutes.get("/debug/versions", (c) => {
  const home = homedir();
  const compactDir = process.env.COMPACT_DIRECTORY || join(home, ".compact");
  const versionsDir = join(compactDir, "versions");

  let cliResult: { output: string; error: string; exitCode: number | null };
  try {
    const output = execSync("compact list --installed 2>&1", { timeout: 5000 }).toString();
    cliResult = { output: output.trim(), error: "", exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    cliResult = {
      output: execErr.stdout?.toString().trim() ?? "",
      error: execErr.stderr?.toString().trim() ?? "",
      exitCode: execErr.status ?? -1,
    };
  }

  let versionsDirInfo: { exists: boolean; contents: string[] };
  try {
    const contents = readdirSync(versionsDir);
    versionsDirInfo = { exists: true, contents };
  } catch {
    versionsDirInfo = { exists: false, contents: [] };
  }

  let compactDirContents: string[] = [];
  try {
    compactDirContents = readdirSync(compactDir);
  } catch {
    // ignore
  }

  return c.json({
    home,
    compactDir,
    compactDirContents,
    versionsDir,
    versionsDirInfo,
    cliResult,
    env: {
      HOME: process.env.HOME,
      COMPACT_DIRECTORY: process.env.COMPACT_DIRECTORY,
      COMPACT_CLI_PATH: process.env.COMPACT_CLI_PATH,
      PATH: process.env.PATH,
    },
  });
});

healthRoutes.get("/libraries", async (c) => {
  try {
    const libraries = await listAvailableLibraries();
    return c.json({ libraries });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list libraries",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { healthRoutes };
