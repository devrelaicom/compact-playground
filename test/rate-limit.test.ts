import { describe, it, expect } from "vitest";
import { getClientIp } from "../backend/src/rate-limit.js";

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
