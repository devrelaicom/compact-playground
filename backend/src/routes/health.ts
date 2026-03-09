import { Hono } from "hono";
import { getCompilerVersion, isCompilerInstalled } from "../utils.js";
import { listInstalledVersions } from "../version-manager.js";
import { getConfig } from "../config.js";

const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const compilerInstalled = await isCompilerInstalled();
  const version = compilerInstalled ? await getCompilerVersion() : null;

  return c.json({
    status: compilerInstalled ? "healthy" : "degraded",
    compiler: {
      installed: compilerInstalled,
      version: version,
    },
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/version", async (c) => {
  const version = await getCompilerVersion();
  return c.json({
    service: "compact-playground",
    serviceVersion: "1.0.0",
    compilerVersion: version || "unknown",
  });
});

healthRoutes.get("/versions", async (c) => {
  const installed = await listInstalledVersions();
  const config = getConfig();
  return c.json({
    default: config.defaultCompilerVersion,
    installed,
  });
});

export { healthRoutes };
