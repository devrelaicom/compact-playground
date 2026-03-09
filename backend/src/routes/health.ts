import { Hono } from "hono";
import { isCompilerInstalled, getCompilerVersion } from "../utils.js";
import { listInstalledVersions, getDefaultVersion, buildLanguageVersionMap } from "../version-manager.js";

const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const cliInstalled = await isCompilerInstalled();
  const cliVersion = cliInstalled ? await getCompilerVersion() : null;

  return c.json({
    status: cliInstalled ? "healthy" : "degraded",
    compactCli: {
      installed: cliInstalled,
      version: cliVersion,
    },
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/versions", async (c) => {
  const defaultVersion = await getDefaultVersion();
  const installed = await listInstalledVersions();

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
