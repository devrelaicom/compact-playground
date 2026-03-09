import { getConfig } from "./config.js";

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

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
