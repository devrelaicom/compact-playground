import { getConfig } from "./config.js";
import type { Context } from "hono";

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Sweep expired entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

export function checkRateLimit(ip: string): boolean {
  const config = getConfig();
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + config.rateWindow });
    return true;
  }

  if (record.count >= config.rateLimit) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Extracts client IP from request headers.
 * Takes the first IP from x-forwarded-for (client IP before proxies),
 * falls back to x-real-ip, then "unknown".
 */
export function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return c.req.header("x-real-ip") || "unknown";
}
