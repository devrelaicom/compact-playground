import { Hono } from "hono";
import { analyzeSource } from "../analyzer.js";
import { compile } from "../compiler.js";
import { checkRateLimit } from "../rate-limit.js";
import { resolveRequestedVersion } from "../version-manager.js";

const analyzeRoutes = new Hono();

analyzeRoutes.post("/analyze", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, mode = "fast", versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required and must be a string" }, 400);
    }

    if (mode === "fast") {
      const analysis = analyzeSource(code);
      return c.json({ success: true, mode: "fast", ...analysis });
    }

    if (mode === "deep") {
      const analysis = analyzeSource(code);

      // Multi-version deep analysis
      if (versions && Array.isArray(versions) && versions.length > 0) {
        // Resolve special version values ("latest", "detect")
        const resolvedVersions = await Promise.all(
          versions.map((v: string) => resolveRequestedVersion(v, code))
        );

        const compileResults = await Promise.allSettled(
          resolvedVersions.map((version: string) =>
            compile(code, { wrapWithDefaults: true, skipZk: true, version })
          )
        );

        const compilations = compileResults.map((result, i) => {
          const requestedVersion = versions[i];
          const resolvedVersion = resolvedVersions[i];
          if (result.status === "fulfilled") {
            return {
              version: resolvedVersion,
              requestedVersion,
              success: result.value.success,
              errors: result.value.errors,
              warnings: result.value.warnings,
              executionTime: result.value.executionTime,
            };
          }
          return {
            version: resolvedVersion,
            requestedVersion,
            success: false,
            errors: [{ message: result.reason?.message || "Compilation failed", severity: "error" }],
          };
        });

        return c.json({
          success: true,
          mode: "deep",
          ...analysis,
          compilations,
        });
      }

      // Single version deep analysis (backward compatible)
      const compileResult = await compile(code, { wrapWithDefaults: true, skipZk: true });
      return c.json({
        success: true,
        mode: "deep",
        ...analysis,
        compilation: {
          success: compileResult.success,
          errors: compileResult.errors,
          warnings: compileResult.warnings,
          executionTime: compileResult.executionTime,
        },
      });
    }

    return c.json({ success: false, error: "Invalid mode. Use 'fast' or 'deep'." }, 400);
  } catch (error) {
    console.error("Analysis error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

export { analyzeRoutes };
