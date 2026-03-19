import { Hono } from "hono";
import { analyzeContract } from "../analysis/index.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { analyzeBodySchema } from "../request-schemas.js";

const analyzeRoutes = new Hono();

analyzeRoutes.post("/analyze", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = analyzeBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0]?.message },
      400,
    );
  }

  const { code, mode, versions, include, circuit } = parsed.data;

  try {
    const { result, cacheKey } = await analyzeContract(code, { mode, versions, include, circuit });
    return c.json({ ...result, cacheKey });
  } catch (error) {
    console.error("Analysis error:", error);
    return c.json(
      {
        success: false,
        errors: [
          {
            message: error instanceof Error ? error.message : "An unknown error occurred",
            severity: "error" as const,
          },
        ],
      },
      500,
    );
  }
});

export { analyzeRoutes };
