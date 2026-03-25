import { Hono } from "hono";
import { compile, type CompileResult } from "../compiler.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";
import { compileBodySchema } from "../request-schemas.js";
import { routeLog, safeErrorMessage } from "../logger.js";
import { ExecutionQueueFullError } from "../execution-limiter.js";

const compileRoutes = new Hono();

compileRoutes.post("/compile", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json(
      {
        success: false,
        error: "Rate limit exceeded",
        message: "Too many requests. Please wait a minute before trying again.",
      },
      429,
    );
  }

  const parsed = compileBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0].message },
      400,
    );
  }

  const { code, options, versions } = parsed.data;

  try {
    // Multi-version: compile against each version
    if (versions && versions.length > 0) {
      const mvResults = await runMultiVersion(versions, code, async (version) => {
        const { result } = await compile(code, { ...options, version });
        return result as unknown as Record<string, unknown>;
      });

      const results: CompileResult[] = mvResults.map((r) => {
        const { requestedVersion, error, ...rest } = r;
        delete (rest as Record<string, unknown>).version;
        const mapped = { ...rest, requestedVersion } as unknown as CompileResult;

        // Convert runMultiVersion's rejected-promise error into errors[]
        if (error && !mapped.errors) {
          mapped.success = false;
          mapped.compiledAt = mapped.compiledAt || new Date().toISOString();
          mapped.errors = [{ message: error, severity: "error" as const }];
        }

        return mapped;
      });

      return c.json({ results });
    }

    // Single version
    const { result, cacheKey } = await compile(code, options);
    return c.json({
      results: [{ ...result, requestedVersion: options.version ?? "default" }],
      cacheKey,
    });
  } catch (error) {
    if (error instanceof ExecutionQueueFullError) {
      return c.json(
        {
          success: false,
          error: "Service busy",
          message: "The server is under heavy load. Please try again shortly.",
        },
        503,
      );
    }

    routeLog.error("Compilation error: {error}", {
      error: safeErrorMessage(error),
      route: "/compile",
    });
    return c.json(
      {
        success: false,
        error: "Internal server error",
        message: "An unexpected error occurred during processing",
      },
      500,
    );
  }
});

export { compileRoutes };
