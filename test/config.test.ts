import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfig } from "../backend/src/config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it("returns default values when no env vars set", () => {
    delete process.env.PORT;
    delete process.env.DEFAULT_COMPILER_VERSION;
    delete process.env.TEMP_DIR;
    delete process.env.COMPACT_CLI_PATH;
    delete process.env.COMPILE_TIMEOUT;
    delete process.env.RATE_LIMIT;
    delete process.env.RATE_WINDOW;

    const config = getConfig();

    expect(config.port).toBe(8080);
    expect(config.defaultCompilerVersion).toBe("latest");
    expect(config.tempDir).toBe("/tmp/compact-playground");
    expect(config.compactCliPath).toBe("compact");
    expect(config.compileTimeout).toBe(30000);
    expect(config.rateLimit).toBe(20);
    expect(config.rateWindow).toBe(60000);
  });

  it("reads values from environment variables", () => {
    process.env.PORT = "3000";
    process.env.DEFAULT_COMPILER_VERSION = "0.26.0";
    process.env.TEMP_DIR = "/custom/tmp";
    process.env.COMPACT_CLI_PATH = "/usr/local/bin/compact";
    process.env.COMPILE_TIMEOUT = "60000";
    process.env.RATE_LIMIT = "50";
    process.env.RATE_WINDOW = "120000";

    const config = getConfig();

    expect(config.port).toBe(3000);
    expect(config.defaultCompilerVersion).toBe("0.26.0");
    expect(config.tempDir).toBe("/custom/tmp");
    expect(config.compactCliPath).toBe("/usr/local/bin/compact");
    expect(config.compileTimeout).toBe(60000);
    expect(config.rateLimit).toBe(50);
    expect(config.rateWindow).toBe(120000);
  });

  it("returns same instance on repeated calls (singleton)", () => {
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b);
  });

  it("returns default OZ paths when no env vars set", () => {
    delete process.env.OZ_CONTRACTS_PATH;

    const config = getConfig();

    expect(config.ozContractsPath).toBe("/opt/oz-compact/contracts/src");
  });

  it("reads OZ contracts path from environment variables", () => {
    process.env.OZ_CONTRACTS_PATH = "/custom/oz/contracts";

    const config = getConfig();

    expect(config.ozContractsPath).toBe("/custom/oz/contracts");
  });

  it("generates an ephemeral cache salt when CACHE_KEY_SALT is unset", () => {
    delete process.env.CACHE_KEY_SALT;

    const config = getConfig();

    expect(config.usingEphemeralCacheSalt).toBe(true);
    expect(config.cacheKeySalt).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses configured cache salt when provided", () => {
    process.env.CACHE_KEY_SALT = "fixed-salt";

    const config = getConfig();

    expect(config.usingEphemeralCacheSalt).toBe(false);
    expect(config.cacheKeySalt).toBe("fixed-salt");
  });

  describe("numeric env validation", () => {
    it("throws on non-numeric PORT", () => {
      process.env.PORT = "abc";
      expect(() => getConfig()).toThrow('Invalid integer for PORT: "abc"');
    });

    it("throws on non-numeric COMPILE_TIMEOUT", () => {
      process.env.COMPILE_TIMEOUT = "not-a-number";
      expect(() => getConfig()).toThrow('Invalid integer for COMPILE_TIMEOUT: "not-a-number"');
    });

    it("throws on non-numeric RATE_LIMIT", () => {
      process.env.RATE_LIMIT = "";
      expect(() => getConfig()).toThrow('Invalid integer for RATE_LIMIT: ""');
    });

    it("throws on non-numeric MAX_CODE_SIZE", () => {
      process.env.MAX_CODE_SIZE = "big";
      expect(() => getConfig()).toThrow('Invalid integer for MAX_CODE_SIZE: "big"');
    });

    it("accepts valid numeric env vars", () => {
      process.env.PORT = "3000";
      process.env.COMPILE_TIMEOUT = "60000";
      process.env.RATE_LIMIT = "50";

      const config = getConfig();

      expect(config.port).toBe(3000);
      expect(config.compileTimeout).toBe(60000);
      expect(config.rateLimit).toBe(50);
    });

    it("uses defaults when numeric env vars are unset", () => {
      delete process.env.PORT;
      delete process.env.COMPILE_TIMEOUT;
      delete process.env.MAX_CODE_SIZE;

      const config = getConfig();

      expect(config.port).toBe(8080);
      expect(config.compileTimeout).toBe(30000);
      expect(config.maxCodeSize).toBe(100 * 1024);
    });

    it("throws on value with trailing non-numeric characters", () => {
      process.env.COMPILE_TIMEOUT = "30s";
      expect(() => getConfig()).toThrow('Invalid integer for COMPILE_TIMEOUT: "30s"');
    });

    it("still resets correctly after validation errors", () => {
      process.env.PORT = "abc";
      expect(() => getConfig()).toThrow();

      resetConfig();
      delete process.env.PORT;

      const config = getConfig();
      expect(config.port).toBe(8080);
    });
  });
});
