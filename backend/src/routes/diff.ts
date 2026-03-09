import { Hono } from "hono";
import { diffContracts } from "../differ.js";
import { checkRateLimit } from "../rate-limit.js";

const diffRoutes = new Hono();

diffRoutes.post("/diff", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { before, after } = body;

    if (!before || typeof before !== "string") {
      return c.json({ success: false, error: "'before' code is required" }, 400);
    }
    if (!after || typeof after !== "string") {
      return c.json({ success: false, error: "'after' code is required" }, 400);
    }

    const result = diffContracts(before, after);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error("Diff error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

export { diffRoutes };
