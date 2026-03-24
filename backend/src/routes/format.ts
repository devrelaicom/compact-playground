import { Hono } from "hono";
import { formatCode, type FormatResult } from "../formatter.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";
import { formatBodySchema } from "../request-schemas.js";
import { routeLog, safeErrorMessage } from "../logger.js";

const formatRoutes = new Hono();

formatRoutes.post("/format", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = formatBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0].message },
      400,
    );
  }

  const { code, options, versions } = parsed.data;

  try {
    // Multi-version: format with each version
    if (versions && versions.length > 0) {
      const mvResults = await runMultiVersion(versions, code, async (version) => {
        const { result } = await formatCode(code, { ...options, version });
        return result as unknown as Record<string, unknown>;
      });

      const results: FormatResult[] = mvResults.map((r) => {
        const { requestedVersion, error, ...rest } = r;
        delete (rest as Record<string, unknown>).version;
        const mapped = { ...rest, requestedVersion } as unknown as FormatResult;

        // Convert runMultiVersion's rejected-promise error into errors[]
        if (error && !mapped.errors) {
          mapped.success = false;
          mapped.errors = [{ message: error, severity: "error" as const }];
        }

        return mapped;
      });

      return c.json({ results });
    }

    // Single version
    const { result, cacheKey } = await formatCode(code, options);
    return c.json({
      results: [{ ...result, requestedVersion: options.version ?? "default" }],
      cacheKey,
    });
  } catch (error) {
    routeLog.error("Format error: {error}", { error: safeErrorMessage(error), route: "/format" });
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An unknown error occurred",
      },
      500,
    );
  }
});

export { formatRoutes };
