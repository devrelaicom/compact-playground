import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConfig } from "./config.js";
import { resolveRequestedVersion } from "./version-manager.js";

/**
 * Hono middleware that enforces an HTTP body size limit on JSON POST endpoints.
 * Rejects oversized requests with 413 before the body is parsed into memory.
 * Skips the /compile/archive multipart endpoint (which has its own limit).
 */
export function createJsonBodyLimit() {
  const config = getConfig();
  const limiter = bodyLimit({
    maxSize: config.maxJsonBodySize,
    onError: (c) =>
      c.json(
        {
          success: false,
          error: "Payload too large",
          message: `Request body must be less than ${String(Math.floor(config.maxJsonBodySize / 1024))}KB`,
        },
        413,
      ),
  });

  return (c: Context, next: Next) => {
    if (c.req.path === "/compile/archive") {
      return next();
    }
    return limiter(c as never, next);
  };
}

/**
 * Hono middleware that validates request bodies for POST endpoints.
 * Checks code size limits and versions array length.
 */
export async function validateRequestBody(c: Context, next: Next) {
  if (c.req.method !== "POST") {
    return next();
  }

  // Skip JSON parsing for multipart endpoints
  if (c.req.path === "/compile/archive") {
    return next();
  }

  const config = getConfig();

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: "Invalid JSON", message: "Request body must be valid JSON" },
      400,
    );
  }

  // Check code size
  if (typeof body.code === "string" && body.code.length > config.maxCodeSize) {
    return c.json(
      {
        success: false,
        error: "Code too large",
        message: `Code must be less than ${String(Math.floor(config.maxCodeSize / 1024))}KB`,
      },
      400,
    );
  }

  // Check before/after size (for /diff endpoint)
  if (typeof body.before === "string" && body.before.length > config.maxCodeSize) {
    return c.json(
      {
        success: false,
        error: "Code too large",
        message: `'before' code must be less than ${String(Math.floor(config.maxCodeSize / 1024))}KB`,
      },
      400,
    );
  }
  if (typeof body.after === "string" && body.after.length > config.maxCodeSize) {
    return c.json(
      {
        success: false,
        error: "Code too large",
        message: `'after' code must be less than ${String(Math.floor(config.maxCodeSize / 1024))}KB`,
      },
      400,
    );
  }

  // Check versions array length
  if (Array.isArray(body.versions) && body.versions.length > config.maxVersionsPerRequest) {
    return c.json(
      {
        success: false,
        error: "Too many versions",
        message: `Maximum ${String(config.maxVersionsPerRequest)} versions per request`,
      },
      400,
    );
  }

  return next();
}

/**
 * Shared multi-version execution helper.
 * Resolves version strings, runs an operation per version via Promise.allSettled,
 * and maps results into a response array preserving executor result shape.
 */
export async function runMultiVersion<T extends Record<string, unknown>>(
  versions: string[],
  code: string,
  executor: (resolvedVersion: string) => Promise<T>,
): Promise<
  (T & { version: string; requestedVersion: string; success: boolean; error?: string })[]
> {
  const resolvedVersions = await Promise.all(
    versions.map((v: string) => resolveRequestedVersion(v, code)),
  );

  const results = await Promise.allSettled(
    resolvedVersions.map((version: string) => executor(version)),
  );

  return results.map((result, i) => {
    const requestedVersion = versions[i];
    const resolvedVersion = resolvedVersions[i];

    if (result.status === "fulfilled") {
      return {
        ...result.value,
        version: resolvedVersion,
        requestedVersion,
        success: result.value.success !== undefined ? (result.value.success as boolean) : true,
      };
    }

    return {
      version: resolvedVersion,
      requestedVersion,
      success: false,
      error: result.reason instanceof Error ? result.reason.message : "Operation failed",
    } as T & { version: string; requestedVersion: string; success: boolean; error: string };
  });
}
