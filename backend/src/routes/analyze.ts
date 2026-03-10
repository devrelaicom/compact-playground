import { Hono } from "hono";
import { analyzeSource } from "../analyzer.js";
import { compile } from "../compiler.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";

const analyzeRoutes = new Hono();

analyzeRoutes.post("/analyze", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
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
        const compilations = await runMultiVersion(versions, code, async (version) => {
          const result = await compile(code, { wrapWithDefaults: true, skipZk: true, version });
          return {
            success: result.success,
            errors: result.errors,
            warnings: result.warnings,
            executionTime: result.executionTime,
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
