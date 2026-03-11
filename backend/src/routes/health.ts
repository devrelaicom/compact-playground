import { Hono } from "hono";
import { getCompilerVersion } from "../utils.js";
import { listInstalledVersions, getDefaultVersion, buildLanguageVersionMap, resolveVersion } from "../version-manager.js";
import { getConfig } from "../config.js";

const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const cliVersion = await getCompilerVersion();
  const cliInstalled = cliVersion !== null;

  const config = getConfig();
  const installed = await listInstalledVersions();
  const defaultVersion = await getDefaultVersion();

  // Check if configured default version is actually available
  const configuredDefault = config.defaultCompilerVersion;
  const defaultVersionValid = configuredDefault === "latest"
    ? installed.length > 0
    : installed.includes(configuredDefault);

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
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/versions", async (c) => {
  const installed = await listInstalledVersions();
  const defaultVersion = resolveVersion("latest", installed);

  let langMap: Map<string, string>;
  try {
    langMap = await buildLanguageVersionMap();
  } catch {
    langMap = new Map();
  }

  const installedWithLang = installed.map((version) => ({
    version,
    languageVersion: langMap.get(version) || "unknown",
  }));

  return c.json({
    default: defaultVersion,
    installed: installedWithLang,
  });
});

export { healthRoutes };
