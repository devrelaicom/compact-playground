import { Hono } from "hono";
import { analyzeContract } from "../analysis/index.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { analyzeBodySchema } from "../request-schemas.js";
import { routeLog, safeErrorMessage } from "../logger.js";
import { RequestAbortedError } from "../process-utils.js";

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
    const { result, cacheKey } = await analyzeContract(code, {
      mode,
      versions,
      include,
      circuit,
      signal: c.req.raw.signal,
    });
    return c.json({ ...result, cacheKey });
  } catch (error) {
    if (error instanceof RequestAbortedError) {
      return new Response(null, { status: 499 });
    }

    routeLog.error("Analysis error: {error}", {
      error: safeErrorMessage(error),
      route: "/analyze",
    });
    return c.json(
      {
        success: false,
        errors: [
          {
            message: "An unexpected error occurred during processing",
            severity: "error" as const,
          },
        ],
      },
      500,
    );
  }
});

export { analyzeRoutes };
