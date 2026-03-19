import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { compile } from "../backend/src/compiler.js";
import { resetFileCache, getFileCache } from "../backend/src/cache.js";
import { resetConfig } from "../backend/src/config.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempCacheDir: string;

describe("compile", () => {
  beforeEach(async () => {
    resetFileCache();
    resetConfig();
    tempCacheDir = await mkdtemp(join(tmpdir(), "compile-cache-test-"));
    process.env.CACHE_DIR = tempCacheDir;
    process.env.CACHE_ENABLED = "true";
    // Initialize the file cache for this test
    const cache = getFileCache();
    if (cache) await cache.init();
  });

  afterEach(async () => {
    resetFileCache();
    resetConfig();
    delete process.env.CACHE_DIR;
    delete process.env.CACHE_ENABLED;
    await rm(tempCacheDir, { recursive: true, force: true });
  });

  it("compiles valid Compact code successfully", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const { result } = await compile(code);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.compiledAt).toBeDefined();
    expect(result.executionTime).toBeGreaterThan(0);
    expect(result.compilerVersion).toBeDefined();
  }, 60000);

  it("returns errors for invalid code", async () => {
    const { result } = await compile("this is not valid compact code");
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.compilerVersion).toBeDefined();
  }, 60000);

  it("wraps code without pragma and reports original/wrapped", async () => {
    const code = `export circuit identity(x: Uint<64>): Uint<64> {
  return x;
}`;
    const { result } = await compile(code);
    expect(result.success).toBe(true);
    expect(result.originalCode).toBe(code);
    expect(result.wrappedCode).toBeDefined();
    expect(result.wrappedCode).toContain("pragma language_version");
    expect(result.wrappedCode).toContain(code);
  }, 60000);

  it("does not wrap code that has a pragma", async () => {
    const code = `pragma language_version >= 0.21;

import CompactStandardLibrary;

export ledger counter: Counter;

export circuit increment(): [] {
  counter.increment(1n);
}`;
    const { result } = await compile(code);
    // Whether it succeeds depends on compiler version, but wrapping should not happen
    expect(result.originalCode).toBeUndefined();
    expect(result.wrappedCode).toBeUndefined();
  }, 60000);

  it("returns cached result on second identical compilation", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const { result: result1 } = await compile(code);
    expect(result1.success).toBe(true);

    const { result: result2 } = await compile(code);
    expect(result2.success).toBe(true);
    // Both should have the same compiledAt (cached)
    expect(result2.compiledAt).toBe(result1.compiledAt);
  }, 60000);

  it("returns TypeScript bindings when includeBindings is true", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const { result } = await compile(code, { includeBindings: true });
    expect(result.success).toBe(true);
    expect(result.bindings).toBeDefined();
    expect(typeof result.bindings).toBe("object");
    const bindings = result.bindings ?? {};
    const filenames = Object.keys(bindings);
    expect(filenames.length).toBeGreaterThan(0);
    expect(filenames.some((f) => f.endsWith(".ts"))).toBe(true);
    for (const content of Object.values(bindings)) {
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
    }
  }, 60000);

  it("does not return bindings when includeBindings is false/absent", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const { result } = await compile(code);
    expect(result.success).toBe(true);
    expect(result.bindings).toBeUndefined();
  }, 60000);

  it("does not return bindings on compilation failure even if includeBindings is true", async () => {
    const { result } = await compile("this is not valid compact code", { includeBindings: true });
    expect(result.success).toBe(false);
    expect(result.bindings).toBeUndefined();
  }, 60000);

  it("caches bindings and non-bindings results separately", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const { result: resultWithout } = await compile(code);
    expect(resultWithout.success).toBe(true);
    expect(resultWithout.bindings).toBeUndefined();

    const { result: resultWith } = await compile(code, { includeBindings: true });
    expect(resultWith.success).toBe(true);
    expect(resultWith.bindings).toBeDefined();
  }, 60000);

  it("does not return cached result after resetFileCache with new dir", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const { result: result1 } = await compile(code);
    expect(result1.success).toBe(true);

    // Reset cache and point to a fresh empty directory
    resetFileCache();
    resetConfig();
    const freshDir = await mkdtemp(join(tmpdir(), "compile-cache-fresh-"));
    process.env.CACHE_DIR = freshDir;
    const cache = getFileCache();
    if (cache) await cache.init();

    const { result: result2 } = await compile(code);
    expect(result2.success).toBe(true);
    // After cache reset with new dir, compiledAt should differ (fresh compilation)
    expect(result2.compiledAt).not.toBe(result1.compiledAt);

    await rm(freshDir, { recursive: true, force: true });
  }, 60000);
});
