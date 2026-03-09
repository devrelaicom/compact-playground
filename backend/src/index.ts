import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getConfig } from "./config.js";
import { compileRoutes } from "./routes/compile.js";
import { formatRoutes } from "./routes/format.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { diffRoutes } from "./routes/diff.js";
import { matrixRoutes } from "./routes/matrix.js";
import { healthRoutes } from "./routes/health.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

// Mount routes
app.route("/", compileRoutes);
app.route("/", formatRoutes);
app.route("/", analyzeRoutes);
app.route("/", diffRoutes);
app.route("/", matrixRoutes);
app.route("/", healthRoutes);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Compact Playground API",
    version: "2.0.0",
    description: "Compile, format, analyze, and diff Compact smart contracts",
    endpoints: {
      "POST /compile": "Compile Compact code",
      "POST /format": "Format Compact code",
      "POST /analyze": "Analyze contract structure (fast/deep)",
      "POST /diff": "Semantic diff between contract versions",
      "POST /matrix": "Compile against multiple compiler versions",
      "GET /versions": "List installed compiler versions",
      "GET /health": "Check service health",
      "GET /version": "Get version information",
    },
  });
});

// Start server
const port = getConfig().port;

console.log(`
╔═══════════════════════════════════════════════════╗
║           Compact Playground API                  ║
║           Starting on port ${port}                    ║
╚═══════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${port}`);
