import { Hono } from "hono";
import { getFileCache } from "../cache.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";

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

  const hash = c.req.param("hash");

  // SHA-256 hex is always exactly 64 lowercase hex characters
  if (!/^[0-9a-f]{64}$/.test(hash)) {
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
    const data = await cache.getByKey(hash);

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
    console.error("Cached response lookup error:", error);
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
