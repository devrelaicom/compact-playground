import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compileArchive } from "../archive-compiler.js";
import { ArchiveValidationError, validateArchiveFormat } from "../archive.js";
import { checkArchiveRateLimit, getClientIp } from "../rate-limit.js";

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

    // Parse optional options JSON
    let options: { skipZk?: boolean; timeout?: number } | undefined;
    const optionsRaw = body["options"];
    if (optionsRaw && typeof optionsRaw === "string") {
      try {
        options = JSON.parse(optionsRaw) as { skipZk?: boolean; timeout?: number };
      } catch {
        return c.json(
          { success: false, error: "Invalid request", message: "options must be valid JSON" },
          400,
        );
      }
    }

    try {
      const { result, cacheKey } = await compileArchive(archiveBuffer, entryPoint, options);
      return c.json({
        results: [{ ...result, requestedVersion: "detect" }],
        cacheKey,
      });
    } catch (error) {
      if (error instanceof ArchiveValidationError) {
        return c.json({ success: false, error: "Validation error", message: error.message }, 400);
      }

      console.error("Archive compilation error:", error);
      return c.json(
        {
          success: false,
          error: "Internal server error",
          message: error instanceof Error ? error.message : "An unknown error occurred",
        },
        500,
      );
    }
  },
);

export { archiveCompileRoutes };
