import { Hono } from "hono";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { visualizeBodySchema } from "../request-schemas.js";
import { parseSource } from "../analysis/parser.js";
import { buildSemanticModel } from "../analysis/semantic-model.js";
import { generateContractGraph } from "../visualizer.js";
import type { VisualizationResult } from "../visualizer.js";
import { getFileCache, generateCacheKey } from "../cache.js";
import { routeLog, safeErrorMessage } from "../logger.js";

const visualizeRoutes = new Hono();

visualizeRoutes.post("/visualize", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = visualizeBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0]?.message },
      400,
    );
  }

  const { code } = parsed.data;

  try {
    const cache = getFileCache();
    const cacheKey = cache ? generateCacheKey(code, "none", { endpoint: "visualize" }) : null;

    if (cache && cacheKey) {
      const cached = await cache.get<VisualizationResult>("visualize", cacheKey);
      if (cached) {
        return c.json({ ...cached, cacheKey: cache.getPublicIdForKey(cacheKey) });
      }
    }

    const source = parseSource(code);
    const model = buildSemanticModel(source);
    const graph = generateContractGraph(source, model);

    const result: VisualizationResult = { success: true, graph };

    if (cache && cacheKey) {
      const publicCacheKey = await cache.set("visualize", cacheKey, result);
      return c.json({ ...result, cacheKey: publicCacheKey });
    }

    return c.json({ ...result, cacheKey: undefined });
  } catch (error) {
    routeLog.error("Visualization error: {error}", {
      error: safeErrorMessage(error),
      route: "/visualize",
    });
    const result: VisualizationResult = {
      success: false,
      errors: [
        {
          message: "An unexpected error occurred during processing",
          severity: "error",
        },
      ],
    };
    return c.json(result, 500);
  }
});

export { visualizeRoutes };
