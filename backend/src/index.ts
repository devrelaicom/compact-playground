import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getConfig } from "./config.js";
import { compileRoutes } from "./routes/compile.js";
import { archiveCompileRoutes } from "./routes/compile-archive.js";
import { formatRoutes } from "./routes/format.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { diffRoutes } from "./routes/diff.js";
import { visualizeRoutes } from "./routes/visualize.js";
import { cachedResponseRoutes } from "./routes/cached-response.js";
import { simulateRoutes } from "./routes/simulate.js";
import { proveRoutes } from "./routes/prove.js";
import { createJsonBodyLimit, validateRequestBody } from "./middleware.js";
import { validateStartup } from "./startup.js";
import { sweepStaleTempDirs } from "./temp-sweeper.js";
import { isShuttingDown, registerShutdownHandlers } from "./shutdown.js";
import { healthRoutes, warmVersionsCache } from "./routes/health.js";
import { getFileCache } from "./cache.js";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
  version: string;
};

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

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
app.route("/", simulateRoutes);
app.route("/", proveRoutes);

app.route("/", healthRoutes);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Compact Playground API",
    version: pkg.version,
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
      "GET /cached-response/:hash": "Retrieve a cached response by its hash key",
      "POST /simulate/deploy": "Deploy a contract for simulation",
      "POST /simulate/:sessionId/call": "Call a circuit on a deployed contract",
      "GET /simulate/:sessionId/state": "Get current session state",
      "DELETE /simulate/:sessionId": "End a simulation session",
      "POST /prove": "Visualize ZK privacy boundaries and proof flow for a contract",
    },
  });
});

// Start server
const port = getConfig().port;

console.log(`
╔═══════════════════════════════════════════════════╗
║           Compact Playground API                  ║
║           Starting on port ${String(port)}                    ║
╚═══════════════════════════════════════════════════╝
`);

// Validate critical runtime dependencies before accepting traffic
const startupCheck = await validateStartup();
if (!startupCheck.ok) {
  for (const error of startupCheck.errors) {
    console.error(`STARTUP ERROR: ${error}`);
  }
  process.exit(1);
}
console.log("Startup validation passed");

// Sweep stale temp directories at startup and periodically
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
sweepStaleTempDirs()
  .then(({ swept, errors }) => {
    if (swept > 0 || errors > 0) {
      console.log(`Startup temp sweep: ${String(swept)} removed, ${String(errors)} errors`);
    }
  })
  .catch((err: unknown) => {
    console.warn("Failed to sweep temp directories:", err);
  });
setInterval(() => {
  sweepStaleTempDirs()
    .then(({ swept, errors }) => {
      if (swept > 0 || errors > 0) {
        console.log(`Periodic temp sweep: ${String(swept)} removed, ${String(errors)} errors`);
      }
    })
    .catch((err: unknown) => {
      console.warn("Periodic temp sweep failed:", err);
    });
}, SWEEP_INTERVAL_MS).unref();

if (!getConfig().cacheKeySalt) {
  console.warn(
    "WARNING: CACHE_KEY_SALT is not set. Cache keys are deterministic and " +
      "cached responses may be retrievable by anyone who can reconstruct inputs.",
  );
}

// Initialize file cache and warm versions cache at startup
const fileCache = getFileCache();
if (fileCache) {
  fileCache
    .init()
    .then(() => {
      console.log("File cache initialized");
    })
    .catch((err: unknown) => {
      console.warn("Failed to initialize file cache:", err);
    });
}

warmVersionsCache()
  .then(() => {
    console.log("Versions cache warmed");
  })
  .catch((err: unknown) => {
    console.warn("Failed to warm versions cache:", err);
  });

const server = serve({
  fetch: app.fetch,
  port,
});

registerShutdownHandlers(server);

console.log(`Server running at http://localhost:${String(port)}`);
