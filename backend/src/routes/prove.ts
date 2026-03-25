import { Hono } from "hono";
import { parseSource } from "../analysis/parser.js";
import { buildSemanticModel } from "../analysis/semantic-model.js";
import { buildProofAnalysis } from "../analysis/proof-analysis.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { proveBodySchema } from "../request-schemas.js";
import { getFileCache, generateCacheKey } from "../cache.js";
import { routeLog, safeErrorMessage } from "../logger.js";

const proveRoutes = new Hono();

proveRoutes.post("/prove", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = proveBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0]?.message },
      400,
    );
  }

  try {
    const { code, circuit } = parsed.data;

    const cache = getFileCache();
    const cacheKey = cache ? generateCacheKey(code, "none", { endpoint: "prove" }) : null;

    const cached =
      cache && cacheKey
        ? await cache.get<ReturnType<typeof buildProofAnalysis>>("prove", cacheKey)
        : null;

    let result: ReturnType<typeof buildProofAnalysis>;

    let publicCacheKey = cache && cacheKey ? cache.getPublicIdForKey(cacheKey) : undefined;

    if (cached) {
      result = cached;
    } else {
      const source = parseSource(code);
      const model = buildSemanticModel(source);
      result = buildProofAnalysis(model);

      if (cache && cacheKey) {
        publicCacheKey = await cache.set("prove", cacheKey, result);
      }
    }

    // Filter by circuit name if requested
    if (circuit) {
      result = {
        ...result,
        circuits: result.circuits.filter((ci) => ci.circuit === circuit),
      };
    }

    return c.json({ ...result, cacheKey: publicCacheKey });
  } catch (error) {
    routeLog.error("Prove analysis error: {error}", {
      error: safeErrorMessage(error),
      route: "/prove",
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

export { proveRoutes };
