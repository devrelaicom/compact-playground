import { Hono } from "hono";
import { diffContracts } from "../differ.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { diffBodySchema } from "../request-schemas.js";

const diffRoutes = new Hono();

diffRoutes.post("/diff", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = diffBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0].message },
      400,
    );
  }

  const { before, after } = parsed.data;

  try {
    const result = diffContracts(before, after);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error("Diff error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An unknown error occurred",
      },
      500,
    );
  }
});

export { diffRoutes };
