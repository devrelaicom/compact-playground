import { Hono } from "hono";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { visualizeBodySchema } from "../request-schemas.js";
import { parseSource } from "../analysis/parser.js";
import { buildSemanticModel } from "../analysis/semantic-model.js";
import { generateContractGraph } from "../visualizer.js";
import type { VisualizationResult } from "../visualizer.js";

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
    const source = parseSource(code);
    const model = buildSemanticModel(source);
    const graph = generateContractGraph(source, model);

    const result: VisualizationResult = { success: true, graph };
    return c.json(result);
  } catch (error) {
    console.error("Visualization error:", error);
    const result: VisualizationResult = {
      success: false,
      errors: [
        {
          message: error instanceof Error ? error.message : "An unknown error occurred",
          severity: "error",
        },
      ],
    };
    return c.json(result, 500);
  }
});

export { visualizeRoutes };
