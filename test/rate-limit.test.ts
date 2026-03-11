import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Context } from "hono";
import { getClientIp, checkRateLimit } from "../backend/src/rate-limit.js";
import { resetConfig } from "../backend/src/config.js";

function mockContext(headers: Record<string, string> = {}, env?: Record<string, unknown>): Context {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] as string | undefined,
    },
    env: env ?? {},
  } as unknown as Context;
}

describe("getClientIp", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_CLOUDFLARE;
    resetConfig();
  });

  describe("with TRUST_PROXY=true", () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = "true";
      resetConfig();
    });

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

  describe("with TRUST_CLOUDFLARE=true", () => {
    beforeEach(() => {
      process.env.TRUST_CLOUDFLARE = "true";
      resetConfig();
    });

    it("reads cf-connecting-ip", () => {
      const c = mockContext({ "cf-connecting-ip": "9.8.7.6" });
      expect(getClientIp(c)).toBe("9.8.7.6");
    });

    it("ignores x-forwarded-for when TRUST_PROXY is not set", () => {
      // No runtime IP either, so falls through to "unknown"
      const c = mockContext({ "x-forwarded-for": "1.2.3.4" });
      expect(getClientIp(c)).toBe("unknown");
    });

    it("prefers cf-connecting-ip over x-forwarded-for when both trusted", () => {
      process.env.TRUST_PROXY = "true";
      resetConfig();
      const c = mockContext({
        "cf-connecting-ip": "9.8.7.6",
        "x-forwarded-for": "1.2.3.4",
      });
      expect(getClientIp(c)).toBe("9.8.7.6");
    });
  });

  describe("with no trust flags (default)", () => {
    beforeEach(() => {
      resetConfig();
    });

    it("ignores all forwarding headers and falls back to runtime IP", () => {
      const c = mockContext(
        {
          "x-forwarded-for": "1.2.3.4",
          "x-real-ip": "5.6.7.8",
          "cf-connecting-ip": "9.8.7.6",
        },
        { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
      );
      expect(getClientIp(c)).toBe("10.0.0.1");
    });

    it("uses runtime IP when present", () => {
      const c = mockContext({}, { incoming: { socket: { remoteAddress: "192.168.1.50" } } });
      expect(getClientIp(c)).toBe("192.168.1.50");
    });

    it("trims runtime IP whitespace", () => {
      const c = mockContext({}, { incoming: { socket: { remoteAddress: "  10.0.0.1  " } } });
      expect(getClientIp(c)).toBe("10.0.0.1");
    });

    it("returns 'unknown' when runtime IP is not available", () => {
      const c = mockContext({});
      expect(getClientIp(c)).toBe("unknown");
    });

    it("returns 'unknown' when env.incoming is missing", () => {
      const c = mockContext({}, { incoming: undefined });
      expect(getClientIp(c)).toBe("unknown");
    });

    it("returns 'unknown' when remoteAddress is empty string", () => {
      const c = mockContext({}, { incoming: { socket: { remoteAddress: "" } } });
      expect(getClientIp(c)).toBe("unknown");
    });
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
