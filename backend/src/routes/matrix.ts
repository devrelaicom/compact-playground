import { Hono } from "hono";
import { buildMatrix, type CompileFn } from "../matrix.js";
import { compile } from "../compiler.js";
import { listInstalledVersions } from "../version-manager.js";
import { checkRateLimit } from "../rate-limit.js";

const matrixRoutes = new Hono();

matrixRoutes.post("/matrix", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required" }, 400);
    }

    const targetVersions: string[] = versions || (await listInstalledVersions());

    if (targetVersions.length === 0) {
      return c.json({ success: false, error: "No compiler versions available" }, 500);
    }

    const compileFn: CompileFn = async (code, version) => {
      const result = await compile(code, { wrapWithDefaults: true, skipZk: true });
      return {
        version,
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
        executionTime: result.executionTime,
      };
    };

    const matrix = await buildMatrix(code, targetVersions, compileFn);
    return c.json({ success: true, matrix });
  } catch (error) {
    console.error("Matrix error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

export { matrixRoutes };
