import { describe, it, expect, beforeEach } from "vitest";
import { CompileCache, normalizeForCacheKey, generateCacheKey } from "../backend/src/cache.js";

describe("CompileCache", () => {
  let cache: CompileCache;

  beforeEach(() => {
    cache = new CompileCache({ maxSize: 10, ttl: 60000 });
  });

  it("returns undefined for cache miss", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    const result = { success: true, output: "Compilation successful", compiledAt: "2026-01-01" };
    cache.set("key1", result);
    expect(cache.get("key1")).toEqual(result);
  });

  it("evicts oldest entry when max size exceeded", () => {
    const cache = new CompileCache({ maxSize: 2, ttl: 60000 });
    cache.set("a", { success: true, compiledAt: "" });
    cache.set("b", { success: true, compiledAt: "" });
    cache.set("c", { success: true, compiledAt: "" });

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("does not return expired entries", () => {
    const cache = new CompileCache({ maxSize: 10, ttl: 1 }); // 1ms TTL
    cache.set("key", { success: true, compiledAt: "" });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get("key")).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it("reports stats correctly", () => {
    cache.set("a", { success: true, compiledAt: "" });
    cache.get("a"); // hit
    cache.get("b"); // miss

    const stats = cache.stats();
    expect(stats.size).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});

describe("normalizeForCacheKey", () => {
  it("trims whitespace", () => {
    expect(normalizeForCacheKey("  code  ")).toBe(normalizeForCacheKey("code"));
  });

  it("normalizes line endings", () => {
    expect(normalizeForCacheKey("a\r\nb")).toBe(normalizeForCacheKey("a\nb"));
  });
});

describe("generateCacheKey", () => {
  it("produces same key for same inputs", () => {
    const a = generateCacheKey("code", "0.26.0", { skipZk: true });
    const b = generateCacheKey("code", "0.26.0", { skipZk: true });
    expect(a).toBe(b);
  });

  it("produces different keys for different code", () => {
    const a = generateCacheKey("code1", "0.26.0", {});
    const b = generateCacheKey("code2", "0.26.0", {});
    expect(a).not.toBe(b);
  });

  it("produces different keys for different versions", () => {
    const a = generateCacheKey("code", "0.26.0", {});
    const b = generateCacheKey("code", "0.25.0", {});
    expect(a).not.toBe(b);
  });

  it("produces different keys for different options", () => {
    const a = generateCacheKey("code", "0.26.0", { skipZk: true });
    const b = generateCacheKey("code", "0.26.0", { skipZk: false });
    expect(a).not.toBe(b);
  });
});
