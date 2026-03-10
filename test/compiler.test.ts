import { describe, it, expect, beforeEach } from "vitest";
import { compile, resetCompileCache } from "../backend/src/compiler.js";

describe("compile", () => {
  beforeEach(() => {
    resetCompileCache();
  });

  it("compiles valid Compact code successfully", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const result = await compile(code);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.compiledAt).toBeDefined();
    expect(result.executionTime).toBeGreaterThan(0);
  }, 60000);

  it("returns errors for invalid code", async () => {
    const result = await compile("this is not valid compact code");
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  }, 60000);

  it("wraps code without pragma and reports original/wrapped", async () => {
    const code = `export circuit identity(x: Uint<64>): Uint<64> {
  return x;
}`;
    const result = await compile(code);
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
    const result = await compile(code);
    // Whether it succeeds depends on compiler version, but wrapping should not happen
    expect(result.originalCode).toBeUndefined();
    expect(result.wrappedCode).toBeUndefined();
  }, 60000);

  it("returns cached result on second identical compilation", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const result1 = await compile(code);
    expect(result1.success).toBe(true);

    const result2 = await compile(code);
    expect(result2.success).toBe(true);
    // Both should have the same compiledAt (cached)
    expect(result2.compiledAt).toBe(result1.compiledAt);
  }, 60000);

  it("does not return cached result after resetCompileCache", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
    const result1 = await compile(code);
    expect(result1.success).toBe(true);

    resetCompileCache();

    const result2 = await compile(code);
    expect(result2.success).toBe(true);
    // After cache reset, compiledAt should differ (fresh compilation)
    expect(result2.compiledAt).not.toBe(result1.compiledAt);
  }, 60000);
});
