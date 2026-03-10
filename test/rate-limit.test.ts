import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getClientIp, checkRateLimit } from "../backend/src/rate-limit.js";
import { resetConfig } from "../backend/src/config.js";

function mockContext(headers: Record<string, string> = {}) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    },
  } as any;
}

describe("getClientIp", () => {
  it("returns single x-forwarded-for value", () => {
    const c = mockContext({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp(c)).toBe("1.2.3.4");
  });

  it("returns first IP from comma-separated x-forwarded-for", () => {
    const c = mockContext({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 192.168.1.1" });
    expect(getClientIp(c)).toBe("1.2.3.4");
  });

  it("trims whitespace from extracted IP", () => {
    const c = mockContext({ "x-forwarded-for": "  1.2.3.4 , 10.0.0.1" });
    expect(getClientIp(c)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const c = mockContext({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp(c)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no IP headers present", () => {
    const c = mockContext({});
    expect(getClientIp(c)).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT = "3";
    process.env.RATE_WINDOW = "100";
    resetConfig();
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT;
    delete process.env.RATE_WINDOW;
    resetConfig();
  });

  it("allows first request from new IP", () => {
    expect(checkRateLimit("192.0.2.1")).toBe(true);
  });

  it("allows requests up to the limit", () => {
    expect(checkRateLimit("192.0.2.2")).toBe(true);
    expect(checkRateLimit("192.0.2.2")).toBe(true);
    expect(checkRateLimit("192.0.2.2")).toBe(true);
  });

  it("blocks requests exceeding the limit", () => {
    checkRateLimit("192.0.2.3");
    checkRateLimit("192.0.2.3");
    checkRateLimit("192.0.2.3");
    expect(checkRateLimit("192.0.2.3")).toBe(false);
  });

  it("tracks IPs independently", () => {
    checkRateLimit("192.0.2.4");
    checkRateLimit("192.0.2.4");
    checkRateLimit("192.0.2.4");
    // IP .4 is now exhausted; .5 should still be allowed
    expect(checkRateLimit("192.0.2.5")).toBe(true);
  });

  it("resets after window expires", async () => {
    checkRateLimit("192.0.2.6");
    checkRateLimit("192.0.2.6");
    checkRateLimit("192.0.2.6");
    // Window is 100ms; wait 150ms for it to expire
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(checkRateLimit("192.0.2.6")).toBe(true);
  });
});
