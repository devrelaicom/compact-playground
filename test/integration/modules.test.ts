import { describe, it, expect } from "vitest";
import { analyzeSource } from "../../backend/src/analyzer.js";
import { diffContracts } from "../../backend/src/differ.js";
import { CompileCache, generateCacheKey, normalizeForCacheKey } from "../../backend/src/cache.js";
import { resolveVersion, compareVersions, isValidVersion } from "../../backend/src/version-manager.js";
import { formatCode } from "../../backend/src/formatter.js";

describe("Integration: Analyze → Diff pipeline", () => {
  it("analyzes two contracts and diffs them end-to-end", () => {
    const v1 = `pragma language_version >= 0.21;

import CompactStandardLibrary;

export ledger counter: Counter;

export circuit increment(): [] {
  counter.increment(1n);
}`;

    const v2 = `pragma language_version >= 0.21;

import CompactStandardLibrary;

export ledger counter: Counter;
export ledger balance: Uint<64>;

export circuit increment(): [] {
  counter.increment(1n);
}

export circuit getBalance(): Uint<64> {
  return balance;
}`;

    // Analyze both versions
    const analysis1 = analyzeSource(v1);
    const analysis2 = analyzeSource(v2);

    expect(analysis1.circuits).toHaveLength(1);
    expect(analysis2.circuits).toHaveLength(2);
    expect(analysis1.ledger).toHaveLength(1);
    expect(analysis2.ledger).toHaveLength(2);

    // Diff them
    const diff = diffContracts(v1, v2);

    expect(diff.hasChanges).toBe(true);
    expect(diff.circuits.added).toHaveLength(1);
    expect(diff.circuits.added[0].name).toBe("getBalance");
    expect(diff.ledger.added).toHaveLength(1);
    expect(diff.ledger.added[0].name).toBe("balance");
    expect(diff.circuits.removed).toHaveLength(0);
    expect(diff.circuits.modified).toHaveLength(0);
  });

  it("detects pragma changes between versions", () => {
    const v1 = `pragma language_version >= 0.21;

export circuit hello(): [] {}`;

    const v2 = `pragma language_version >= 0.25;

export circuit hello(): [] {}`;

    const diff = diffContracts(v1, v2);

    expect(diff.hasChanges).toBe(true);
    expect(diff.pragma.changed).toBe(true);
    expect(diff.pragma.before).toBe(">= 0.21");
    expect(diff.pragma.after).toBe(">= 0.25");
    expect(diff.circuits.added).toHaveLength(0);
    expect(diff.circuits.removed).toHaveLength(0);
  });

  it("detects modified circuit signatures", () => {
    const v1 = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;

    const v2 = `export circuit add(a: Uint<64>, b: Uint<64>, c: Uint<64>): Uint<64> {
  return (a + b + c) as Uint<64>;
}`;

    const diff = diffContracts(v1, v2);

    expect(diff.hasChanges).toBe(true);
    expect(diff.circuits.modified).toHaveLength(1);
    expect(diff.circuits.modified[0].name).toBe("add");
    expect(diff.circuits.modified[0].changes).toContain("params");
  });

  it("reports no changes for identical contracts", () => {
    const code = `pragma language_version >= 0.21;

import CompactStandardLibrary;

export ledger counter: Counter;

export circuit increment(): [] {
  counter.increment(1n);
}`;

    const diff = diffContracts(code, code);

    expect(diff.hasChanges).toBe(false);
    expect(diff.circuits.added).toHaveLength(0);
    expect(diff.circuits.removed).toHaveLength(0);
    expect(diff.circuits.modified).toHaveLength(0);
    expect(diff.ledger.added).toHaveLength(0);
    expect(diff.ledger.removed).toHaveLength(0);
  });
});

describe("Integration: Cache with real compile keys", () => {
  it("caches and retrieves compilation results with proper key generation", () => {
    const cache = new CompileCache({ maxSize: 100, ttl: 60000 });
    const code = "export circuit test(): [] {}";
    const version = "0.26.0";
    const options = { skipZk: true, wrapWithDefaults: true };

    const key = generateCacheKey(code, version, options);
    expect(typeof key).toBe("string");
    expect(key.length).toBe(64); // SHA-256 hex

    // Cache miss
    expect(cache.get(key)).toBeUndefined();

    // Store result
    const result = { success: true, output: "Compilation successful", compiledAt: new Date().toISOString() };
    cache.set(key, result);

    // Cache hit
    expect(cache.get(key)).toEqual(result);

    // Same code with different version = different key
    const key2 = generateCacheKey(code, "0.25.0", options);
    expect(key2).not.toBe(key);
    expect(cache.get(key2)).toBeUndefined();
  });

  it("normalizes whitespace differences before keying", () => {
    // normalizeForCacheKey trims leading/trailing whitespace and normalizes CRLF → LF
    const key1 = generateCacheKey("  code  ", "0.26.0", {});
    const key2 = generateCacheKey("code", "0.26.0", {});
    // After trim: both become "code"
    expect(key1).toBe(key2);

    const key3 = generateCacheKey("a\r\nb", "0.26.0", {});
    const key4 = generateCacheKey("a\nb", "0.26.0", {});
    expect(key3).toBe(key4);
  });

  it("evicts oldest entry when cache is full", () => {
    const cache = new CompileCache({ maxSize: 2, ttl: 60000 });

    cache.set("key1", { success: true });
    cache.set("key2", { success: true });
    cache.set("key3", { success: true }); // Should evict key1

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeDefined();
    expect(cache.get("key3")).toBeDefined();
  });

  it("tracks hit/miss statistics across operations", () => {
    const cache = new CompileCache({ maxSize: 10, ttl: 60000 });
    const key = generateCacheKey("test", "0.26.0", {});

    cache.get(key); // miss
    cache.set(key, { success: true });
    cache.get(key); // hit
    cache.get(key); // hit

    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
    expect(stats.size).toBe(1);
  });
});

describe("Integration: Version resolution", () => {
  it("resolves latest version from installed list", () => {
    const installed = ["0.24.0", "0.25.0", "0.26.0"];
    const latest = resolveVersion("latest", installed);
    expect(latest).toBe("0.26.0");
  });

  it("validates and compares versions correctly", () => {
    expect(isValidVersion("0.26.0")).toBe(true);
    expect(isValidVersion("latest")).toBe(false);
    expect(isValidVersion("1.2")).toBe(false);
    expect(isValidVersion("abc")).toBe(false);

    expect(compareVersions("0.25.0", "0.26.0")).toBeLessThan(0);
    expect(compareVersions("0.26.0", "0.25.0")).toBeGreaterThan(0);
    expect(compareVersions("0.26.0", "0.26.0")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("returns null when resolving an unavailable version", () => {
    const installed = ["0.24.0", "0.25.0"];
    expect(resolveVersion("0.30.0", installed)).toBeNull();
    expect(resolveVersion("latest", [])).toBeNull();
  });
});

describe("Integration: Format endpoint", () => {
  it("formats code using compact CLI", async () => {
    const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;
    const result = await formatCode(code);

    expect(result.success).toBe(true);
    expect(result.formatted).toBeDefined();
    expect(result.changed).toBe(true);
    // Formatted code should have proper spacing
    expect(result.formatted).toContain("a: Uint<64>");
  });

  it("always returns diff when code changed", async () => {
    const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;
    // No diff option — diff should still be returned when changed
    const result = await formatCode(code);

    expect(result.success).toBe(true);
    if (result.changed) {
      expect(result.diff).toBeDefined();
      expect(result.diff!.length).toBeGreaterThan(0);
    }
  });

  it("detects unchanged code", async () => {
    const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}
`;
    const result = await formatCode(code);

    expect(result.success).toBe(true);
    expect(result.changed).toBe(false);
  });

  it("returns error for empty input", async () => {
    const result = await formatCode("");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
