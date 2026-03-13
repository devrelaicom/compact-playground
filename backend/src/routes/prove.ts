import { Hono } from "hono";
import { parseSource } from "../analysis/parser.js";
import { buildSemanticModel } from "../analysis/semantic-model.js";
import { buildProofAnalysis } from "../analysis/proof-analysis.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { proveBodySchema } from "../request-schemas.js";
import { getFileCache, generateCacheKey } from "../cache.js";

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

    if (cache && cacheKey) {
      const cached = await cache.get("prove", cacheKey);
      if (cached) {
        const result = cached as ReturnType<typeof buildProofAnalysis>;
        if (circuit) {
          return c.json({
            ...result,
            circuits: result.circuits.filter((ci) => ci.circuit === circuit),
            cacheKey,
          });
        }
        return c.json({ ...result, cacheKey });
      }
    }

    const source = parseSource(code);
    const model = buildSemanticModel(source);
    let result = buildProofAnalysis(model);

    if (cache && cacheKey) {
      await cache.set("prove", cacheKey, result);
    }

    if (circuit) {
      result = {
        ...result,
        circuits: result.circuits.filter((ci) => ci.circuit === circuit),
      };
    }

    return c.json({ ...result, cacheKey: cacheKey ?? undefined });
  } catch (error) {
    console.error("Prove analysis error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An unknown error occurred",
      },
      500,
    );
  }
});

export { proveRoutes };
