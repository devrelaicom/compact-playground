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
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/versions", (c) => {
  if (!cachedVersionsResponse) {
    return c.json({ error: "Version information not yet available" }, 503);
  }
  return c.json(cachedVersionsResponse);
});

export { healthRoutes };
