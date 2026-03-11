import { Hono } from "hono";
import { formatCode } from "../formatter.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";
import { formatBodySchema } from "../request-schemas.js";

const formatRoutes = new Hono();

formatRoutes.post("/format", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = formatBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0].message },
      400
    );
  }

  const { code, options, versions } = parsed.data;

  try {
    // Multi-version: format with each version
    if (versions && versions.length > 0) {
      const results = await runMultiVersion(versions, code, (version) =>
        formatCode(code, { ...options, version }) as unknown as Promise<Record<string, unknown>>
      );
      return c.json({ success: true, results });
    }

    // Single version (backward compatible): flat response
    const result = await formatCode(code, options);
    return c.json(result);
  } catch (error) {
    console.error("Format error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

export { formatRoutes };
