import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { compile } from "./compiler.js";
import { formatCode } from "./formatter.js";
import { getCompilerVersion, isCompilerInstalled } from "./utils.js";
import { getConfig } from "./config.js";

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

// Rate limiting state (simple in-memory implementation)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const config = getConfig();
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + config.rateWindow });
    return true;
  }

  if (record.count >= config.rateLimit) {
    return false;
  }

  record.count++;
  return true;
}

// Health check endpoint
app.get("/health", async (c) => {
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

// Version endpoint
app.get("/version", async (c) => {
  const version = await getCompilerVersion();
  return c.json({
    service: "compact-playground",
    serviceVersion: "1.0.0",
    compilerVersion: version || "unknown",
  });
});

// Main compile endpoint
app.post("/compile", async (c) => {
  // Rate limiting
  const ip =
    c.req.header("x-forwarded-for") ||
    c.req.header("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(ip)) {
    return c.json(
      {
        success: false,
        error: "Rate limit exceeded",
        message: "Too many requests. Please wait a minute before trying again.",
      },
      429
    );
  }

  try {
    const body = await c.req.json();
    const { code, options = {} } = body;

    if (!code || typeof code !== "string") {
      return c.json(
        {
          success: false,
          error: "Invalid request",
          message: "Code is required and must be a string",
        },
        400
      );
    }

    // Limit code size (100KB max)
    if (code.length > 100 * 1024) {
      return c.json(
        {
          success: false,
          error: "Code too large",
          message: "Code must be less than 100KB",
        },
        400
      );
    }

    const result = await compile(code, options);
    return c.json(result);
  } catch (error) {
    console.error("Compilation error:", error);
    return c.json(
      {
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "An unknown error occurred",
      },
      500
    );
  }
});

// Format endpoint
app.post("/format", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, options = {} } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required and must be a string" }, 400);
    }

    if (code.length > 100 * 1024) {
      return c.json({ success: false, error: "Code must be less than 100KB" }, 400);
    }

    const result = await formatCode(code, options);
    return c.json(result);
  } catch (error) {
    console.error("Format error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Compact Playground API",
    version: "1.0.0",
    description: "Compile and validate Compact smart contracts",
    endpoints: {
      "POST /compile": "Compile Compact code",
      "GET /health": "Check service health",
      "GET /version": "Get version information",
    },
    documentation: "https://github.com/Olanetsoft/learn-compact",
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
