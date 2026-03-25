import { existsSync } from "fs";
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
import { routeLog, safeErrorMessage } from "../logger.js";

const healthRoutes = new Hono();
const HEALTH_CACHE_TTL_MS = 30_000;

// Pre-computed versions response, populated at startup via warmVersionsCache()
let cachedVersionsResponse: {
  default: string | null;
  installed: { version: string; languageVersion: string }[];
} | null = null;
let cachedHealthResponse: { timestamp: number; body: Record<string, unknown> } | null = null;

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
  if (cachedHealthResponse && Date.now() - cachedHealthResponse.timestamp < HEALTH_CACHE_TTL_MS) {
    return c.json(cachedHealthResponse.body);
  }

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
  const body = {
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
    },
    timestamp: new Date().toISOString(),
  };

  cachedHealthResponse = { timestamp: Date.now(), body };
  return c.json(body);
});

healthRoutes.get("/versions", (c) => {
  if (!cachedVersionsResponse) {
    return c.json({ error: "Version information not yet available" }, 503);
  }
  return c.json(cachedVersionsResponse);
});

healthRoutes.get("/libraries", async (c) => {
  try {
    const libraries = await listAvailableLibraries();
    return c.json({ libraries });
  } catch (error) {
    routeLog.error("Libraries listing error: {error}", {
      error: safeErrorMessage(error),
      route: "/libraries",
    });
    return c.json(
      {
        success: false,
        error: "Internal server error",
        message: "An unexpected error occurred during processing",
      },
      500,
    );
  }
});

export { healthRoutes };
