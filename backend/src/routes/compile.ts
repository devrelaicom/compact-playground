import { Hono } from "hono";
import { compile } from "../compiler.js";
import { checkRateLimit } from "../rate-limit.js";

const compileRoutes = new Hono();

compileRoutes.post("/compile", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json(
      { success: false, error: "Rate limit exceeded", message: "Too many requests. Please wait a minute before trying again." },
      429
    );
  }

  try {
    const body = await c.req.json();
    const { code, options = {} } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Invalid request", message: "Code is required and must be a string" }, 400);
    }

    if (code.length > 100 * 1024) {
      return c.json({ success: false, error: "Code too large", message: "Code must be less than 100KB" }, 400);
    }

    const result = await compile(code, options);
    return c.json(result);
  } catch (error) {
    console.error("Compilation error:", error);
    return c.json(
      { success: false, error: "Internal server error", message: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

export { compileRoutes };
