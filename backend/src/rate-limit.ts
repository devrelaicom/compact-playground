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
 * Best-effort extraction of the runtime-provided client IP from the
 * server/platform context. With @hono/node-server this is available
 * via c.env.incoming.socket.remoteAddress. Other adapters may differ,
 * so this is defensive and returns null when unavailable.
 */
function getRuntimeIp(c: Context): string | null {
  const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming?.socket?.remoteAddress;

  if (typeof addr === "string" && addr.trim()) {
    return addr.trim();
  }

  return null;
}

/**
 * Extracts client IP from request based on trust configuration.
 *
 * Precedence:
 * 1. TRUST_CLOUDFLARE=true → CF-Connecting-IP (set by Cloudflare, not spoofable)
 * 2. TRUST_PROXY=true → x-forwarded-for / x-real-ip (only safe behind a trusted reverse proxy)
 * 3. Runtime/platform-provided client IP (e.g. Node socket remoteAddress)
 * 4. "unknown" (safe final fallback)
 */
export function getClientIp(c: Context): string {
  const config = getConfig();

  if (config.trustCloudflare) {
    const cfIp = c.req.header("cf-connecting-ip");
    if (cfIp) return cfIp.trim();
  }

  if (config.trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();

    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp.trim();
  }

  const runtimeIp = getRuntimeIp(c);
  if (runtimeIp) return runtimeIp;

  return "unknown";
}
