import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compileArchive } from "../archive-compiler.js";
import { ArchiveValidationError, validateArchiveFormat } from "../archive.js";
import { checkArchiveRateLimit, getClientIp } from "../rate-limit.js";
import { routeLog, safeErrorMessage } from "../logger.js";
import { ExecutionQueueFullError } from "../execution-limiter.js";
import { archiveOptionsSchema } from "../request-schemas.js";
import { RequestAbortedError } from "../process-utils.js";

const MAX_COMPRESSED_SIZE = 1 * 1024 * 1024; // 1 MB

const archiveCompileRoutes = new Hono();

archiveCompileRoutes.post(
  "/compile/archive",
  bodyLimit({
    maxSize: MAX_COMPRESSED_SIZE,
    onError: (c) =>
      c.json(
        {
          success: false,
          error: "Invalid request",
          message: "Archive exceeds maximum compressed size of 1MB",
        },
        400,
      ),
  }),
  async (c) => {
    if (!checkArchiveRateLimit(getClientIp(c))) {
      return c.json(
        {
          success: false,
          error: "Rate limit exceeded",
          message: "Too many requests. Please wait before trying again.",
        },
        429,
      );
    }

    let body: Record<string, string | File>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json(
        {
          success: false,
          error: "Invalid request",
          message: "Failed to parse multipart form data",
        },
        400,
      );
    }

    // Extract and validate archive file
    const archive = body["archive"];
    if (!archive || !(archive instanceof File)) {
      return c.json(
        { success: false, error: "Invalid request", message: "archive file is required" },
        400,
      );
    }

    const archiveBuffer = Buffer.from(await archive.arrayBuffer());

    if (archiveBuffer.length > MAX_COMPRESSED_SIZE) {
      return c.json(
        {
          success: false,
          error: "Invalid request",
          message: "Archive exceeds maximum compressed size of 1MB",
        },
        400,
      );
    }

    if (!validateArchiveFormat(archiveBuffer)) {
      return c.json(
        {
          success: false,
          error: "Invalid request",
          message: "Invalid archive format. Expected a .tar.gz file",
        },
        400,
      );
    }

    // Extract and validate entryPoint
    const entryPoint = body["entryPoint"];
    if (!entryPoint || typeof entryPoint !== "string") {
      return c.json(
        { success: false, error: "Invalid request", message: "entryPoint field is required" },
        400,
      );
    }

    // Parse and validate optional options JSON
    let options: { skipZk?: boolean; timeout?: number } | undefined;
    const optionsRaw = body["options"];
    if (optionsRaw && typeof optionsRaw === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(optionsRaw);
      } catch {
        return c.json(
          { success: false, error: "Invalid request", message: "options must be valid JSON" },
          400,
        );
      }

      const validated = archiveOptionsSchema.safeParse(parsed);
      if (!validated.success) {
        return c.json(
          {
            success: false,
            error: "Invalid request",
            message: "Invalid options: " + validated.error.issues[0].message,
          },
          400,
        );
      }
      options = validated.data;
    }

    try {
      const { result, cacheKey } = await compileArchive(archiveBuffer, entryPoint, {
        ...options,
        signal: c.req.raw.signal,
      });
      return c.json({
        results: [{ ...result, requestedVersion: "detect" }],
        cacheKey,
      });
    } catch (error) {
      if (error instanceof RequestAbortedError) {
        return new Response(null, { status: 499 });
      }

      if (error instanceof ArchiveValidationError) {
        return c.json({ success: false, error: "Validation error", message: error.message }, 400);
      }

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

      routeLog.error("Archive compilation error: {error}", {
        error: safeErrorMessage(error),
        route: "/compile/archive",
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
  },
);

export { archiveCompileRoutes };
