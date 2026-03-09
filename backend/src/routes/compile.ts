import { Hono } from "hono";
import { compile } from "../compiler.js";
import { checkRateLimit } from "../rate-limit.js";
import { resolveRequestedVersion } from "../version-manager.js";

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
    const { code, options = {}, versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Invalid request", message: "Code is required and must be a string" }, 400);
    }

    if (code.length > 100 * 1024) {
      return c.json({ success: false, error: "Code too large", message: "Code must be less than 100KB" }, 400);
    }

    // Multi-version: if versions array provided, compile against each
    if (versions && Array.isArray(versions) && versions.length > 0) {
      // Resolve special version values ("latest", "detect")
      const resolvedVersions = await Promise.all(
        versions.map((v: string) => resolveRequestedVersion(v, code))
      );

      const results = await Promise.allSettled(
        resolvedVersions.map((version: string) => compile(code, { ...options, version }))
      );

      const matrix = results.map((result, i) => {
        const requestedVersion = versions[i];
        const resolvedVersion = resolvedVersions[i];
        if (result.status === "fulfilled") {
          return { version: resolvedVersion, requestedVersion, ...result.value };
        }
        return {
          version: resolvedVersion,
          requestedVersion,
          success: false,
          errors: [{ message: result.reason?.message || "Compilation failed", severity: "error" }],
          compiledAt: new Date().toISOString(),
        };
      });

      return c.json({ success: true, results: matrix });
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
