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
});
