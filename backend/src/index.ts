import { readFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConfig } from "./config.js";
import { setupLogging, startupLog } from "./logger.js";
import { compileRoutes } from "./routes/compile.js";
import { archiveCompileRoutes } from "./routes/compile-archive.js";
import { formatRoutes } from "./routes/format.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { diffRoutes } from "./routes/diff.js";
import { visualizeRoutes } from "./routes/visualize.js";
import { cachedResponseRoutes } from "./routes/cached-response.js";
import { proveRoutes } from "./routes/prove.js";
import { createJsonBodyLimit, validateRequestBody } from "./middleware.js";
import { validateStartup } from "./startup.js";
import { sweepStaleTempDirs } from "./temp-sweeper.js";
import { isShuttingDown, registerShutdownHandlers } from "./shutdown.js";
import { healthRoutes, warmVersionsCache } from "./routes/health.js";
import { getFileCache } from "./cache.js";

let pkgVersion = "unknown";
try {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
    version?: string;
  };
  pkgVersion = pkg.version || pkgVersion;
} catch {
  // Fall back to "unknown" if package.json is unavailable at runtime.
}

const app = new Hono();

// Initialize structured logging
await setupLogging();

// Middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Cache-Control", "no-store");
});

// Reject new requests during shutdown (before any body parsing)
app.use("*", async (c, next) => {
  if (isShuttingDown()) {
    return c.json({ success: false, error: "Service is shutting down" }, 503);
  }
  return next();
});

app.use("*", createJsonBodyLimit());
app.use("*", validateRequestBody);

// Mount routes
app.route("/", compileRoutes);
app.route("/", archiveCompileRoutes);
app.route("/", formatRoutes);
app.route("/", analyzeRoutes);
app.route("/", diffRoutes);
app.route("/", visualizeRoutes);
app.route("/", cachedResponseRoutes);
app.route("/", proveRoutes);

app.route("/", healthRoutes);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Compact Playground API",
    version: pkgVersion,
    description: "Compile, format, analyze, and diff Compact smart contracts",
    endpoints: {
      "POST /compile": 'Compile Compact code (versions: ["latest", "detect", or specific])',
      "POST /format": 'Format Compact code (versions: ["latest", "detect", or specific])',
      "POST /analyze":
        'Analyze contract structure (fast/deep, versions: ["latest", "detect", or specific])',
      "POST /compile/archive": "Compile multi-file Compact archives (.tar.gz)",
      "POST /diff": "Semantic diff between contract versions",
      "POST /visualize": "Generate visual graph of contract architecture",
      "GET /versions": "List installed compiler versions with language version mapping",
      "GET /health": "Check service health",
      "GET /cached-response/:hash": "Retrieve a cached response by its opaque cache token",
      "POST /prove": "Visualize ZK privacy boundaries and proof flow for a contract",
    },
  });
});

// Start server
const port = getConfig().port;

startupLog.info("Compact Playground API starting on port {port}", { port });

// Validate critical runtime dependencies before accepting traffic
const startupCheck = await validateStartup();
if (!startupCheck.ok) {
  for (const error of startupCheck.errors) {
    startupLog.error("STARTUP ERROR: {error}", { error });
  }
  process.exit(1);
}
startupLog.info("Startup validation passed");

// Sweep stale temp directories at startup and periodically
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
sweepStaleTempDirs()
  .then(({ swept, errors }) => {
    if (swept > 0 || errors > 0) {
      startupLog.info("Startup temp sweep: {swept} removed, {errors} errors", { swept, errors });
    }
  })
  .catch((err: unknown) => {
    startupLog.warn("Failed to sweep temp directories: {error}", { error: String(err) });
  });
setInterval(() => {
  sweepStaleTempDirs()
    .then(({ swept, errors }) => {
      if (swept > 0 || errors > 0) {
        startupLog.info("Periodic temp sweep: {swept} removed, {errors} errors", { swept, errors });
      }
    })
    .catch((err: unknown) => {
      startupLog.warn("Periodic temp sweep failed: {error}", { error: String(err) });
    });
}, SWEEP_INTERVAL_MS).unref();

const config = getConfig();
if (config.usingEphemeralCacheSalt) {
  startupLog.warn(
    "CACHE_KEY_SALT is not set. Using an ephemeral cache salt for this process and " +
      "clearing persisted cache on startup. Cache lookups will not survive restart.",
  );

  try {
    const entries = await readdir(config.cacheDir);
    await Promise.all(
      entries.map((entry) => rm(join(config.cacheDir, entry), { recursive: true, force: true })),
    );
  } catch {
    // Directory may not exist (e.g. deleted by a prior version). Recreate it.
    await mkdir(config.cacheDir, { recursive: true }).catch(() => {});
  }
}

// Initialize file cache and warm versions cache at startup
const fileCache = getFileCache();
if (fileCache) {
  try {
    await fileCache.init();
    startupLog.info("File cache initialized");
  } catch (err: unknown) {
    startupLog.warn("Failed to initialize file cache: {error}", { error: String(err) });
  }
}

warmVersionsCache()
  .then(() => {
    startupLog.info("Versions cache warmed");
  })
  .catch((err: unknown) => {
    startupLog.warn("Failed to warm versions cache: {error}", { error: String(err) });
  });

const server = serve({
  fetch: app.fetch,
  port,
});

registerShutdownHandlers(server);

startupLog.info("Server running at http://localhost:{port}", { port });
