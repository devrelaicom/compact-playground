import { Hono } from "hono";
import { getFileCache } from "../cache.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { routeLog, safeErrorMessage } from "../logger.js";

const cachedResponseRoutes = new Hono();

cachedResponseRoutes.get("/cached-response/:hash", async (c) => {
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

  const publicId = c.req.param("hash");

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId)
  ) {
    return c.json(
      {
        success: false,
        message: "Cached response not found or has expired",
      },
      404,
    );
  }

  const cache = getFileCache();

  if (!cache) {
    return c.json(
      {
        success: false,
        message: "Cached response not found or has expired",
      },
      404,
    );
  }

  try {
    const data = await cache.getByPublicId(publicId);

    if (!data) {
      return c.json(
        {
          success: false,
          message: "Cached response not found or has expired",
        },
        404,
      );
    }

    return c.json(data);
  } catch (error) {
    routeLog.error("Cached response lookup error: {error}", {
      error: safeErrorMessage(error),
      route: "/cached-response",
    });
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An unknown error occurred",
      },
      500,
    );
  }
});

export { cachedResponseRoutes };
