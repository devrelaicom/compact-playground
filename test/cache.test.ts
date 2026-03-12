import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  FileCache,
  normalizeForCacheKey,
  generateCacheKey,
  generateArchiveCacheKey,
} from "../backend/src/cache.js";

describe("FileCache", () => {
  let tempDir: string;
  let cache: FileCache;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "filecache-test-"));
    cache = new FileCache(tempDir, 60000, 100, 1000);
    await cache.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns undefined for cache miss", async () => {
    expect(await cache.get("compile", "nonexistent")).toBeUndefined();
  });

  it("stores and retrieves a value", async () => {
    const data = { success: true, output: "Compilation successful" };
    await cache.set("compile", "key1", data);
    expect(await cache.get("compile", "key1")).toEqual(data);
  });

  it("persists across instances", async () => {
    const data = { success: true, output: "test" };
    await cache.set("compile", "key1", data);

    // Create a new cache instance pointing to same dir
    const cache2 = new FileCache(tempDir, 60000, 100, 1000);
    await cache2.init();
    expect(await cache2.get("compile", "key1")).toEqual(data);
  });

  it("does not return expired entries", async () => {
    const shortTtlCache = new FileCache(tempDir, 1, 100, 1000); // 1ms TTL
    await shortTtlCache.init();
    await shortTtlCache.set("compile", "key1", { value: "test" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await shortTtlCache.get("compile", "key1")).toBeUndefined();
  });

  it("reports stats correctly", async () => {
    await cache.set("compile", "a", { value: 1 });
    await cache.get("compile", "a"); // hit
    await cache.get("compile", "b"); // miss

    const stats = cache.stats();
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it("uses two-level hash directories", async () => {
    const key = "a3f7b2c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef";
    await cache.set("compile", key, { value: "test" });

    const subdirs = await readdir(join(tempDir, "compile"));
    expect(subdirs).toContain("a3");
  });

  it("caches across different endpoints independently", async () => {
    await cache.set("compile", "key1", { type: "compile" });
    await cache.set("format", "key1", { type: "format" });

    expect(await cache.get("compile", "key1")).toEqual({ type: "compile" });
    expect(await cache.get("format", "key1")).toEqual({ type: "format" });
  });

  it("evicts oldest entries when over maxEntries during purge", async () => {
    const smallCache = new FileCache(tempDir, 60000, 100, 3);
    await smallCache.init();

    await smallCache.set("compile", "aaa", { v: 1 });
    await smallCache.set("compile", "bbb", { v: 2 });
    await smallCache.set("compile", "ccc", { v: 3 });

    // Access "aaa" to make it recent
    await smallCache.get("compile", "aaa");

    // Add a 4th entry and explicitly purge
    await smallCache.set("compile", "ddd", { v: 4 });
    await smallCache.purge();

    // "bbb" should be evicted (oldest atime), "aaa" was accessed recently
    const stats = smallCache.stats();
    expect(stats.entries).toBeLessThanOrEqual(3);
  });

  it("init removes expired files from disk", async () => {
    const shortTtlCache = new FileCache(tempDir, 1, 100, 1000);
    await shortTtlCache.init();
    await shortTtlCache.set("compile", "expired", { v: 1 });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // New instance should clean up expired entries on init
    const freshCache = new FileCache(tempDir, 1, 100, 1000);
    await freshCache.init();
    expect(freshCache.stats().entries).toBe(0);
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

describe("generateArchiveCacheKey", () => {
  const archive = Buffer.from("fake archive content");

  it("produces deterministic keys for same input", () => {
    const a = generateArchiveCacheKey(archive, "0.26.0", { optimize: true });
    const b = generateArchiveCacheKey(archive, "0.26.0", { optimize: true });
    expect(a).toBe(b);
  });

  it("produces different keys for different archive buffers", () => {
    const other = Buffer.from("different archive content");
    const a = generateArchiveCacheKey(archive, "0.26.0", {});
    const b = generateArchiveCacheKey(other, "0.26.0", {});
    expect(a).not.toBe(b);
  });

  it("produces different keys for different versions", () => {
    const a = generateArchiveCacheKey(archive, "0.26.0", {});
    const b = generateArchiveCacheKey(archive, "0.25.0", {});
    expect(a).not.toBe(b);
  });

  it("produces different keys for different options", () => {
    const a = generateArchiveCacheKey(archive, "0.26.0", { optimize: true });
    const b = generateArchiveCacheKey(archive, "0.26.0", { optimize: false });
    expect(a).not.toBe(b);
  });
});
