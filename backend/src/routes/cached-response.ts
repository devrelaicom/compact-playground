import { Hono } from "hono";
import { getFileCache } from "../cache.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";

const cachedResponseRoutes = new Hono();

cachedResponseRoutes.get("/cached-response/:hash", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const hash = c.req.param("hash");
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
});

export { cachedResponseRoutes };
