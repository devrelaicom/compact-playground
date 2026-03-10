import { Hono } from "hono";
import { compile } from "../compiler.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";

const compileRoutes = new Hono();

compileRoutes.post("/compile", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json(
      { success: false, error: "Rate limit exceeded", message: "Too many requests. Please wait a minute before trying again." },
      429
    );
  }

  try {
    const body = await c.req.json();
    const { code, options = {}, versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Invalid request", message: "Code is required and must be a string" }, 400);
    }

    // Multi-version: compile against each version
    if (versions && Array.isArray(versions) && versions.length > 0) {
      const results = await runMultiVersion(versions, code, (version) =>
        compile(code, { ...options, version }) as unknown as Promise<Record<string, unknown>>
      );
      return c.json({ success: true, results });
    }

    // Single version (backward compatible): flat response
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
