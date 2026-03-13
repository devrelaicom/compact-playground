import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getConfig } from "./config.js";
import { compileRoutes } from "./routes/compile.js";
import { formatRoutes } from "./routes/format.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { diffRoutes } from "./routes/diff.js";
import { visualizeRoutes } from "./routes/visualize.js";
import { cachedResponseRoutes } from "./routes/cached-response.js";
import { simulateRoutes } from "./routes/simulate.js";
import { validateRequestBody } from "./middleware.js";

import { healthRoutes, warmVersionsCache } from "./routes/health.js";
import { getFileCache } from "./cache.js";

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

app.use("*", validateRequestBody);

// Mount routes
app.route("/", compileRoutes);
app.route("/", formatRoutes);
app.route("/", analyzeRoutes);
app.route("/", diffRoutes);
app.route("/", visualizeRoutes);
app.route("/", cachedResponseRoutes);
app.route("/", simulateRoutes);

app.route("/", healthRoutes);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Compact Playground API",
    version: "2.0.0",
    description: "Compile, format, analyze, and diff Compact smart contracts",
    endpoints: {
      "POST /compile": 'Compile Compact code (versions: ["latest", "detect", or specific])',
      "POST /format": 'Format Compact code (versions: ["latest", "detect", or specific])',
      "POST /analyze":
        'Analyze contract structure (fast/deep, versions: ["latest", "detect", or specific])',
      "POST /diff": "Semantic diff between contract versions",
      "POST /visualize": "Generate visual graph of contract architecture",
      "GET /versions": "List installed compiler versions with language version mapping",
      "GET /health": "Check service health",
      "GET /cached-response/:hash": "Retrieve a cached response by its hash key",
      "POST /simulate/deploy": "Deploy a contract for simulation",
      "POST /simulate/:sessionId/call": "Call a circuit on a deployed contract",
      "GET /simulate/:sessionId/state": "Get current session state",
      "DELETE /simulate/:sessionId": "End a simulation session",
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

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${String(port)}`);
