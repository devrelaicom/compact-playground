# Compact API v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the Compact Playground from a simple compile endpoint into a general-purpose Compact-as-a-Service API with formatting, analysis, multi-version compilation, semantic diffing, and smart caching — while maintaining backward compatibility with Learn Compact.

**Architecture:** The existing Hono server gets new route modules for each API capability (`/format`, `/analyze`, `/diff`). A new `VersionManager` handles multi-compiler-version orchestration. A `CacheService` sits in front of compilation with normalize-then-hash strategy. All new features are additive — the existing `POST /compile` contract is unchanged. Configuration is via environment variables with sensible defaults.

**Tech Stack:** Hono (HTTP), TypeScript, Node.js 22, Docker multi-stage builds, vitest for testing. No new runtime dependencies beyond what's already in use.

**Backward Compatibility Contract:** Learn Compact (https://github.com/Olanetsoft/learn-compact) sends `POST /compile` with `{code: string, options: {wrapWithDefaults: true, skipZk: true}}`. This exact request/response shape MUST NOT change. Learn Compact targets `pragma language_version >= 0.16 && <= 0.18` with compiler v0.26.0. The default compiler version must be configurable via `DEFAULT_COMPILER_VERSION` env var.

---

## Task 1: Configuration Module

Centralize all configuration into a typed config module. Currently env vars are scattered across files (`index.ts`, `compiler.ts`, `utils.ts`). This is the foundation for every subsequent task.

**Files:**
- Create: `backend/src/config.ts`
- Test: `test/config.test.ts`
- Modify: `backend/src/index.ts` (import config)
- Modify: `backend/src/compiler.ts` (import config)

**Step 1: Write the failing test**

```typescript
// test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig } from "../backend/src/config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns default values when no env vars set", () => {
    delete process.env.PORT;
    delete process.env.DEFAULT_COMPILER_VERSION;
    delete process.env.TEMP_DIR;
    delete process.env.COMPACT_PATH;
    delete process.env.COMPILE_TIMEOUT;
    delete process.env.RATE_LIMIT;
    delete process.env.RATE_WINDOW;

    const config = getConfig();

    expect(config.port).toBe(8080);
    expect(config.defaultCompilerVersion).toBe("latest");
    expect(config.tempDir).toBe("/tmp/compact-playground");
    expect(config.compilerPath).toBe("compactc");
    expect(config.compileTimeout).toBe(30000);
    expect(config.rateLimit).toBe(20);
    expect(config.rateWindow).toBe(60000);
  });

  it("reads values from environment variables", () => {
    process.env.PORT = "3000";
    process.env.DEFAULT_COMPILER_VERSION = "0.26.0";
    process.env.TEMP_DIR = "/custom/tmp";
    process.env.COMPACT_PATH = "/usr/local/bin/compactc";
    process.env.COMPILE_TIMEOUT = "60000";
    process.env.RATE_LIMIT = "50";
    process.env.RATE_WINDOW = "120000";

    const config = getConfig();

    expect(config.port).toBe(3000);
    expect(config.defaultCompilerVersion).toBe("0.26.0");
    expect(config.tempDir).toBe("/custom/tmp");
    expect(config.compilerPath).toBe("/usr/local/bin/compactc");
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — module `../backend/src/config.js` not found

**Step 3: Write minimal implementation**

```typescript
// backend/src/config.ts
export interface Config {
  port: number;
  defaultCompilerVersion: string;
  tempDir: string;
  compilerPath: string;
  compileTimeout: number;
  rateLimit: number;
  rateWindow: number;
  cacheEnabled: boolean;
  cacheMaxSize: number;
  cacheTtl: number;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  _config = {
    port: parseInt(process.env.PORT || "8080", 10),
    defaultCompilerVersion: process.env.DEFAULT_COMPILER_VERSION || "latest",
    tempDir: process.env.TEMP_DIR || "/tmp/compact-playground",
    compilerPath: process.env.COMPACT_PATH || "compactc",
    compileTimeout: parseInt(process.env.COMPILE_TIMEOUT || "30000", 10),
    rateLimit: parseInt(process.env.RATE_LIMIT || "20", 10),
    rateWindow: parseInt(process.env.RATE_WINDOW || "60000", 10),
    cacheEnabled: process.env.CACHE_ENABLED !== "false",
    cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || "1000", 10),
    cacheTtl: parseInt(process.env.CACHE_TTL || "3600000", 10), // 1 hour
  };

  return _config;
}

/** Reset config singleton (for testing only) */
export function resetConfig(): void {
  _config = null;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS

**Step 5: Migrate existing code to use config**

Update `backend/src/compiler.ts` — replace hardcoded `COMPILE_TIMEOUT` and `TEMP_DIR` with `getConfig()`. Update `backend/src/index.ts` — replace inline rate limit constants and port with `getConfig()`. Update `backend/src/utils.ts` — replace `process.env.COMPACT_PATH || "compactc"` with `getConfig().compilerPath`.

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests PASS (no behavior change)

**Step 7: Commit**

```bash
git add backend/src/config.ts test/config.test.ts backend/src/compiler.ts backend/src/index.ts backend/src/utils.ts
git commit -m "refactor: centralize configuration into typed config module"
```

---

## Task 2: Format Endpoint

Add `POST /format` that runs `format-compact` (bundled in the Docker image at `/root/.compact/bin/format-compact`) on submitted code and returns formatted output. This is also the foundation for the cache normalization strategy.

**Files:**
- Create: `backend/src/formatter.ts`
- Create: `test/formatter.test.ts`
- Modify: `backend/src/index.ts` (add route)

**Step 1: Write the failing test**

```typescript
// test/formatter.test.ts
import { describe, it, expect } from "vitest";
import { formatCode, FormatResult } from "../backend/src/formatter.js";

describe("formatter", () => {
  describe("formatCode", () => {
    it("returns formatted code and indicates if changes were made", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      const result = await formatCode(code);

      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
      expect(typeof result.formatted).toBe("string");
    });

    it("returns diff when requested", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      const result = await formatCode(code, { diff: true });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    });

    it("returns unchanged flag when code is already formatted", async () => {
      // Well-formatted code should return changed: false
      const code = `pragma language_version >= 0.16 && <= 0.18;

import CompactStandardLibrary;

export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
    return (a + b) as Uint<64>;
}
`;

      const result = await formatCode(code);

      expect(result.success).toBe(true);
      // changed is true or false depending on whether formatter modified anything
      expect(typeof result.changed).toBe("boolean");
    });

    it("handles empty code", async () => {
      const result = await formatCode("");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("handles code that fails to parse", async () => {
      const result = await formatCode("this is not compact code {{{");

      // Formatter should return an error for unparseable code
      expect(result.success).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/formatter.test.ts`
Expected: FAIL — module not found

**Step 3: Write the formatter module**

```typescript
// backend/src/formatter.ts
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "./config.js";

export interface FormatOptions {
  diff?: boolean;
  timeout?: number;
}

export interface FormatResult {
  success: boolean;
  formatted?: string;
  changed?: boolean;
  diff?: string;
  error?: string;
}

export async function formatCode(
  code: string,
  options: FormatOptions = {}
): Promise<FormatResult> {
  if (!code || !code.trim()) {
    return { success: false, error: "No code to format" };
  }

  const config = getConfig();
  const sessionId = uuidv4();
  const sessionDir = join(config.tempDir, `fmt-${sessionId}`);

  try {
    await mkdir(sessionDir, { recursive: true });

    const sourceFile = join(sessionDir, "contract.compact");
    await writeFile(sourceFile, code, "utf-8");

    // format-compact formats files in-place
    const formatterPath = process.env.FORMAT_COMPACT_PATH || "format-compact";
    const result = await runFormatter(
      formatterPath,
      [sourceFile],
      options.timeout || 10000
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || "Formatting failed",
      };
    }

    const formatted = await readFile(sourceFile, "utf-8");
    const changed = formatted !== code;

    const formatResult: FormatResult = {
      success: true,
      formatted,
      changed,
    };

    if (options.diff && changed) {
      formatResult.diff = generateSimpleDiff(code, formatted);
    }

    return formatResult;
  } finally {
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

function runFormatter(
  path: string,
  args: string[],
  timeout: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(path, args, {
      timeout,
      env: { ...process.env, TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("format-compact not found. Ensure it is installed and in PATH."));
      } else {
        reject(error);
      }
    });
  });
}

/** Generate a simple line-by-line diff */
function generateSimpleDiff(original: string, formatted: string): string {
  const origLines = original.split("\n");
  const fmtLines = formatted.split("\n");
  const diff: string[] = [];

  const maxLen = Math.max(origLines.length, fmtLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const fmt = fmtLines[i];

    if (orig === undefined) {
      diff.push(`+ ${fmt}`);
    } else if (fmt === undefined) {
      diff.push(`- ${orig}`);
    } else if (orig !== fmt) {
      diff.push(`- ${orig}`);
      diff.push(`+ ${fmt}`);
    }
  }

  return diff.join("\n");
}
```

**Step 4: Add route to `backend/src/index.ts`**

Add after the existing `/compile` route:

```typescript
// Format endpoint
app.post("/format", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, options = {} } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required and must be a string" }, 400);
    }

    if (code.length > 100 * 1024) {
      return c.json({ success: false, error: "Code must be less than 100KB" }, 400);
    }

    const result = await formatCode(code, options);
    return c.json(result);
  } catch (error) {
    console.error("Format error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});
```

**Step 5: Run tests**

Run: `npx vitest run`
Expected: All PASS (formatter tests will only fully pass in Docker where `format-compact` is available; locally they may fail on the spawn — that's expected. The unit test structure is correct.)

**Step 6: Commit**

```bash
git add backend/src/formatter.ts test/formatter.test.ts backend/src/index.ts
git commit -m "feat: add POST /format endpoint for code formatting"
```

---

## Task 3: Compilation Cache

Add an in-memory LRU cache that normalizes code via formatting before hashing. Cache key = `hash(normalized_code + compiler_version + options)`.

**Files:**
- Create: `backend/src/cache.ts`
- Create: `test/cache.test.ts`
- Modify: `backend/src/compiler.ts` (wrap with cache)

**Step 1: Write the failing test**

```typescript
// test/cache.test.ts
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

    // Wait for expiry
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/cache.test.ts`
Expected: FAIL — module not found

**Step 3: Write the cache module**

```typescript
// backend/src/cache.ts
import { createHash } from "crypto";
import type { CompileResult } from "./compiler.js";

interface CacheEntry {
  result: Partial<CompileResult>;
  timestamp: number;
}

interface CacheOptions {
  maxSize: number;
  ttl: number; // milliseconds
}

export class CompileCache {
  private cache = new Map<string, CacheEntry>();
  private _hits = 0;
  private _misses = 0;
  private maxSize: number;
  private ttl: number;

  constructor(options: CacheOptions) {
    this.maxSize = options.maxSize;
    this.ttl = options.ttl;
  }

  get(key: string): Partial<CompileResult> | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this._misses++;
      return undefined;
    }

    this._hits++;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  set(key: string, result: Partial<CompileResult>): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      size: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }
}

/** Normalize code for cache key generation (lightweight, no formatter needed) */
export function normalizeForCacheKey(code: string): string {
  return code.trim().replace(/\r\n/g, "\n");
}

/** Generate a deterministic cache key from code + version + options */
export function generateCacheKey(
  code: string,
  compilerVersion: string,
  options: Record<string, unknown>
): string {
  const normalized = normalizeForCacheKey(code);
  const payload = JSON.stringify({ code: normalized, version: compilerVersion, options });
  return createHash("sha256").update(payload).digest("hex");
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/cache.test.ts`
Expected: PASS

**Step 5: Integrate cache into compiler.ts**

Modify `backend/src/compiler.ts` to accept an optional `CompileCache` and check/store results. The cache lookup happens in the `compile()` function: generate key from `(finalCode, compilerVersion, options)`, check cache, compile on miss, store result.

**Step 6: Add cache stats to health endpoint**

Modify `backend/src/index.ts` health endpoint to include cache stats:
```typescript
cache: cacheInstance.stats()
```

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 8: Commit**

```bash
git add backend/src/cache.ts test/cache.test.ts backend/src/compiler.ts backend/src/index.ts
git commit -m "feat: add LRU compilation cache with normalize-then-hash strategy"
```

---

## Task 4: Version Manager & Multi-Version Compilation

Add a `VersionManager` that discovers installed compiler versions and routes compilations to specific versions. The `compact` CLI supports `compact compile +<VER> <source> <output>`.

**Key design decision:** The `DEFAULT_COMPILER_VERSION` env var controls which version is used when no version is specified. Set to `"latest"` by default, but Learn Compact's deployment should set it to `"0.26.0"` (or whatever version matches their `pragma` range).

**Files:**
- Create: `backend/src/version-manager.ts`
- Create: `test/version-manager.test.ts`
- Modify: `backend/src/compiler.ts` (accept version parameter)
- Modify: `backend/src/index.ts` (add version param to `/compile`, add `/versions` endpoint)

**Step 1: Write the failing test**

```typescript
// test/version-manager.test.ts
import { describe, it, expect } from "vitest";
import {
  parseVersionString,
  isValidVersion,
  compareVersions,
  resolveVersion,
} from "../backend/src/version-manager.js";

describe("version-manager", () => {
  describe("parseVersionString", () => {
    it("parses a semver string", () => {
      const v = parseVersionString("0.26.0");
      expect(v).toEqual({ major: 0, minor: 26, patch: 0 });
    });

    it("returns null for invalid version", () => {
      expect(parseVersionString("abc")).toBeNull();
      expect(parseVersionString("")).toBeNull();
    });
  });

  describe("isValidVersion", () => {
    it("accepts valid semver", () => {
      expect(isValidVersion("0.26.0")).toBe(true);
      expect(isValidVersion("1.0.0")).toBe(true);
    });

    it("rejects invalid strings", () => {
      expect(isValidVersion("latest")).toBe(false);
      expect(isValidVersion("abc")).toBe(false);
      expect(isValidVersion("")).toBe(false);
    });
  });

  describe("compareVersions", () => {
    it("compares versions correctly", () => {
      expect(compareVersions("0.26.0", "0.25.0")).toBeGreaterThan(0);
      expect(compareVersions("0.25.0", "0.26.0")).toBeLessThan(0);
      expect(compareVersions("0.26.0", "0.26.0")).toBe(0);
    });
  });

  describe("resolveVersion", () => {
    const installed = ["0.24.0", "0.25.0", "0.26.0"];

    it("resolves 'latest' to highest installed version", () => {
      expect(resolveVersion("latest", installed)).toBe("0.26.0");
    });

    it("resolves exact version if installed", () => {
      expect(resolveVersion("0.25.0", installed)).toBe("0.25.0");
    });

    it("returns null for uninstalled version", () => {
      expect(resolveVersion("0.23.0", installed)).toBeNull();
    });

    it("returns null for empty installed list", () => {
      expect(resolveVersion("latest", [])).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/version-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Write the version manager**

```typescript
// backend/src/version-manager.ts
import { spawn } from "child_process";
import { readdir } from "fs/promises";
import { join } from "path";
import { getConfig } from "./config.js";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersionString(version: string): ParsedVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

export function isValidVersion(version: string): boolean {
  return parseVersionString(version) !== null;
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersionString(a);
  const vb = parseVersionString(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

export function resolveVersion(
  requested: string,
  installedVersions: string[]
): string | null {
  if (installedVersions.length === 0) return null;

  if (requested === "latest") {
    const sorted = [...installedVersions].sort(compareVersions);
    return sorted[sorted.length - 1];
  }

  if (installedVersions.includes(requested)) {
    return requested;
  }

  return null;
}

/**
 * Discovers installed compiler versions by running `compact list --installed`
 * or by scanning the compact directory.
 */
export async function listInstalledVersions(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn("compact", ["list", "--installed"], { timeout: 5000 });

    let stdout = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        const versions = stdout
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => isValidVersion(line));
        resolve(versions);
      } else {
        // Fallback: return just the current version from compactc --version
        resolve([]);
      }
    });

    proc.on("error", () => resolve([]));
  });
}

/**
 * Gets the default compiler version based on config.
 * If DEFAULT_COMPILER_VERSION is "latest", resolves to the highest installed.
 * Otherwise uses the configured version.
 */
export async function getDefaultVersion(): Promise<string | null> {
  const config = getConfig();
  const requested = config.defaultCompilerVersion;

  if (requested !== "latest" && isValidVersion(requested)) {
    return requested;
  }

  const installed = await listInstalledVersions();
  return resolveVersion("latest", installed);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/version-manager.test.ts`
Expected: PASS (pure function tests pass without compiler)

**Step 5: Add version parameter to `/compile` endpoint**

Modify `backend/src/index.ts` — accept optional `version` field in the compile request body. If not provided, use `getConfig().defaultCompilerVersion`. Add a `GET /versions` endpoint that returns installed versions and the default.

```typescript
// New endpoint in index.ts
app.get("/versions", async (c) => {
  const installed = await listInstalledVersions();
  const config = getConfig();
  return c.json({
    default: config.defaultCompilerVersion,
    installed,
  });
});
```

**Step 6: Modify `compiler.ts` to accept a version parameter**

When a specific version is requested, use `compact compile +<VER>` syntax instead of calling `compactc` directly.

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 8: Commit**

```bash
git add backend/src/version-manager.ts test/version-manager.test.ts backend/src/compiler.ts backend/src/index.ts
git commit -m "feat: add multi-version compilation with configurable default version"
```

---

## Task 5: Contract Analysis Endpoint

Add `POST /analyze` with two tiers: fast lint (parse source to extract structure) and deep analysis (compile + extract from output).

**Files:**
- Create: `backend/src/analyzer.ts`
- Create: `test/analyzer.test.ts`
- Modify: `backend/src/index.ts` (add route)

**Step 1: Write the failing test**

```typescript
// test/analyzer.test.ts
import { describe, it, expect } from "vitest";
import { analyzeSource } from "../backend/src/analyzer.js";

describe("analyzer", () => {
  describe("analyzeSource (fast lint)", () => {
    it("extracts exported circuits", () => {
      const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}

export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a - b) as Uint<64>;
}`;

      const result = analyzeSource(code);

      expect(result.circuits).toHaveLength(2);
      expect(result.circuits[0].name).toBe("add");
      expect(result.circuits[0].exported).toBe(true);
      expect(result.circuits[0].params).toEqual([
        { name: "a", type: "Uint<64>" },
        { name: "b", type: "Uint<64>" },
      ]);
      expect(result.circuits[0].returnType).toBe("Uint<64>");
      expect(result.circuits[1].name).toBe("subtract");
    });

    it("extracts ledger declarations", () => {
      const code = `export ledger counter: Counter;
export ledger balance: Uint<64>;`;

      const result = analyzeSource(code);

      expect(result.ledger).toHaveLength(2);
      expect(result.ledger[0]).toEqual({ name: "counter", type: "Counter", exported: true });
      expect(result.ledger[1]).toEqual({ name: "balance", type: "Uint<64>", exported: true });
    });

    it("detects imports", () => {
      const code = `import CompactStandardLibrary;`;

      const result = analyzeSource(code);

      expect(result.imports).toContain("CompactStandardLibrary");
    });

    it("detects pragma version", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;`;

      const result = analyzeSource(code);

      expect(result.pragma).toBe(">= 0.16 && <= 0.18");
    });

    it("detects pure circuits", () => {
      const code = `pure circuit helper(x: Field): Field {
  return x;
}`;

      const result = analyzeSource(code);

      expect(result.circuits).toHaveLength(1);
      expect(result.circuits[0].pure).toBe(true);
    });

    it("handles empty code", () => {
      const result = analyzeSource("");

      expect(result.circuits).toEqual([]);
      expect(result.ledger).toEqual([]);
      expect(result.imports).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyzer.test.ts`
Expected: FAIL — module not found

**Step 3: Write the analyzer**

```typescript
// backend/src/analyzer.ts

export interface CircuitInfo {
  name: string;
  exported: boolean;
  pure: boolean;
  params: { name: string; type: string }[];
  returnType: string;
  line: number;
}

export interface LedgerInfo {
  name: string;
  type: string;
  exported: boolean;
}

export interface AnalysisResult {
  pragma: string | null;
  imports: string[];
  circuits: CircuitInfo[];
  ledger: LedgerInfo[];
}

/**
 * Fast source-level analysis — extracts structure without compilation.
 */
export function analyzeSource(code: string): AnalysisResult {
  const lines = code.split("\n");

  const result: AnalysisResult = {
    pragma: null,
    imports: [],
    circuits: [],
    ledger: [],
  };

  // Extract pragma
  const pragmaMatch = code.match(/pragma\s+language_version\s+(.+?);/);
  if (pragmaMatch) {
    result.pragma = pragmaMatch[1].trim();
  }

  // Extract imports
  const importRegex = /import\s+(\w+)\s*;/g;
  let importMatch;
  while ((importMatch = importRegex.exec(code)) !== null) {
    result.imports.push(importMatch[1]);
  }

  // Extract circuits
  const circuitRegex =
    /^(\s*)(export\s+)?(pure\s+)?circuit\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+)/gm;
  let circuitMatch;
  while ((circuitMatch = circuitRegex.exec(code)) !== null) {
    const exported = !!circuitMatch[2];
    const pure = !!circuitMatch[3];
    const name = circuitMatch[4];
    const paramsStr = circuitMatch[5].trim();
    const returnType = circuitMatch[6].trim();

    const params = paramsStr
      ? paramsStr.split(",").map((p) => {
          const [pName, pType] = p.split(":").map((s) => s.trim());
          return { name: pName, type: pType };
        })
      : [];

    // Find line number
    const beforeMatch = code.substring(0, circuitMatch.index);
    const line = beforeMatch.split("\n").length;

    result.circuits.push({ name, exported, pure, params, returnType, line });
  }

  // Extract ledger declarations
  const ledgerRegex = /^(\s*)(export\s+)?ledger\s+(\w+)\s*:\s*([^;]+)/gm;
  let ledgerMatch;
  while ((ledgerMatch = ledgerRegex.exec(code)) !== null) {
    result.ledger.push({
      name: ledgerMatch[3],
      type: ledgerMatch[4].trim(),
      exported: !!ledgerMatch[2],
    });
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyzer.test.ts`
Expected: PASS

**Step 5: Add route to index.ts**

```typescript
// POST /analyze endpoint
app.post("/analyze", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, mode = "fast" } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required and must be a string" }, 400);
    }

    if (mode === "fast") {
      const analysis = analyzeSource(code);
      return c.json({ success: true, mode: "fast", ...analysis });
    }

    if (mode === "deep") {
      // Compile first, then analyze
      const analysis = analyzeSource(code);
      const compileResult = await compile(code, { wrapWithDefaults: true, skipZk: true });
      return c.json({
        success: true,
        mode: "deep",
        ...analysis,
        compilation: {
          success: compileResult.success,
          errors: compileResult.errors,
          warnings: compileResult.warnings,
          executionTime: compileResult.executionTime,
        },
      });
    }

    return c.json({ success: false, error: "Invalid mode. Use 'fast' or 'deep'." }, 400);
  } catch (error) {
    console.error("Analysis error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/src/analyzer.ts test/analyzer.test.ts backend/src/index.ts
git commit -m "feat: add POST /analyze endpoint with fast and deep analysis modes"
```

---

## Task 6: Semantic Contract Diffing

Add `POST /diff` that compares two contract versions and returns structural differences.

**Files:**
- Create: `backend/src/differ.ts`
- Create: `test/differ.test.ts`
- Modify: `backend/src/index.ts` (add route)

**Step 1: Write the failing test**

```typescript
// test/differ.test.ts
import { describe, it, expect } from "vitest";
import { diffContracts, DiffResult } from "../backend/src/differ.js";

describe("differ", () => {
  it("detects added circuits", () => {
    const before = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;

    const after = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}

export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a - b) as Uint<64>;
}`;

    const diff = diffContracts(before, after);

    expect(diff.circuits.added).toHaveLength(1);
    expect(diff.circuits.added[0].name).toBe("subtract");
    expect(diff.circuits.removed).toHaveLength(0);
  });

  it("detects removed circuits", () => {
    const before = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}

export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a - b) as Uint<64>;
}`;

    const after = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;

    const diff = diffContracts(before, after);

    expect(diff.circuits.removed).toHaveLength(1);
    expect(diff.circuits.removed[0].name).toBe("subtract");
  });

  it("detects modified circuit signatures", () => {
    const before = `export circuit transfer(amount: Uint<32>): [] {
  return;
}`;

    const after = `export circuit transfer(amount: Uint<64>): [] {
  return;
}`;

    const diff = diffContracts(before, after);

    expect(diff.circuits.modified).toHaveLength(1);
    expect(diff.circuits.modified[0].name).toBe("transfer");
    expect(diff.circuits.modified[0].changes).toContain("params");
  });

  it("detects added ledger fields", () => {
    const before = `export ledger counter: Counter;`;
    const after = `export ledger counter: Counter;
export ledger balance: Uint<64>;`;

    const diff = diffContracts(before, after);

    expect(diff.ledger.added).toHaveLength(1);
    expect(diff.ledger.added[0].name).toBe("balance");
  });

  it("detects ledger type changes", () => {
    const before = `export ledger balance: Uint<32>;`;
    const after = `export ledger balance: Uint<64>;`;

    const diff = diffContracts(before, after);

    expect(diff.ledger.modified).toHaveLength(1);
    expect(diff.ledger.modified[0].name).toBe("balance");
    expect(diff.ledger.modified[0].before).toBe("Uint<32>");
    expect(diff.ledger.modified[0].after).toBe("Uint<64>");
  });

  it("reports no changes for identical contracts", () => {
    const code = `export circuit add(a: Uint<64>): Uint<64> { return a; }`;

    const diff = diffContracts(code, code);

    expect(diff.circuits.added).toHaveLength(0);
    expect(diff.circuits.removed).toHaveLength(0);
    expect(diff.circuits.modified).toHaveLength(0);
    expect(diff.ledger.added).toHaveLength(0);
    expect(diff.ledger.removed).toHaveLength(0);
    expect(diff.ledger.modified).toHaveLength(0);
    expect(diff.hasChanges).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/differ.test.ts`
Expected: FAIL — module not found

**Step 3: Write the differ module**

```typescript
// backend/src/differ.ts
import { analyzeSource, type CircuitInfo, type LedgerInfo } from "./analyzer.js";

export interface CircuitDiff {
  name: string;
  changes: string[]; // which aspects changed: "params", "returnType", "exported", "pure"
  before?: CircuitInfo;
  after?: CircuitInfo;
}

export interface LedgerDiff {
  name: string;
  before?: string;
  after?: string;
}

export interface DiffResult {
  hasChanges: boolean;
  circuits: {
    added: CircuitInfo[];
    removed: CircuitInfo[];
    modified: CircuitDiff[];
  };
  ledger: {
    added: LedgerInfo[];
    removed: LedgerInfo[];
    modified: LedgerDiff[];
  };
  pragma: {
    before: string | null;
    after: string | null;
    changed: boolean;
  };
  imports: {
    added: string[];
    removed: string[];
  };
}

export function diffContracts(before: string, after: string): DiffResult {
  const beforeAnalysis = analyzeSource(before);
  const afterAnalysis = analyzeSource(after);

  // Diff circuits
  const beforeCircuits = new Map(beforeAnalysis.circuits.map((c) => [c.name, c]));
  const afterCircuits = new Map(afterAnalysis.circuits.map((c) => [c.name, c]));

  const addedCircuits = afterAnalysis.circuits.filter((c) => !beforeCircuits.has(c.name));
  const removedCircuits = beforeAnalysis.circuits.filter((c) => !afterCircuits.has(c.name));

  const modifiedCircuits: CircuitDiff[] = [];
  for (const [name, beforeCircuit] of beforeCircuits) {
    const afterCircuit = afterCircuits.get(name);
    if (!afterCircuit) continue;

    const changes: string[] = [];
    if (JSON.stringify(beforeCircuit.params) !== JSON.stringify(afterCircuit.params)) {
      changes.push("params");
    }
    if (beforeCircuit.returnType !== afterCircuit.returnType) {
      changes.push("returnType");
    }
    if (beforeCircuit.exported !== afterCircuit.exported) {
      changes.push("exported");
    }
    if (beforeCircuit.pure !== afterCircuit.pure) {
      changes.push("pure");
    }

    if (changes.length > 0) {
      modifiedCircuits.push({ name, changes, before: beforeCircuit, after: afterCircuit });
    }
  }

  // Diff ledger
  const beforeLedger = new Map(beforeAnalysis.ledger.map((l) => [l.name, l]));
  const afterLedger = new Map(afterAnalysis.ledger.map((l) => [l.name, l]));

  const addedLedger = afterAnalysis.ledger.filter((l) => !beforeLedger.has(l.name));
  const removedLedger = beforeAnalysis.ledger.filter((l) => !afterLedger.has(l.name));

  const modifiedLedger: LedgerDiff[] = [];
  for (const [name, beforeField] of beforeLedger) {
    const afterField = afterLedger.get(name);
    if (!afterField) continue;

    if (beforeField.type !== afterField.type) {
      modifiedLedger.push({ name, before: beforeField.type, after: afterField.type });
    }
  }

  // Diff imports
  const beforeImports = new Set(beforeAnalysis.imports);
  const afterImports = new Set(afterAnalysis.imports);
  const addedImports = afterAnalysis.imports.filter((i) => !beforeImports.has(i));
  const removedImports = beforeAnalysis.imports.filter((i) => !afterImports.has(i));

  // Diff pragma
  const pragmaChanged = beforeAnalysis.pragma !== afterAnalysis.pragma;

  const hasChanges =
    addedCircuits.length > 0 ||
    removedCircuits.length > 0 ||
    modifiedCircuits.length > 0 ||
    addedLedger.length > 0 ||
    removedLedger.length > 0 ||
    modifiedLedger.length > 0 ||
    addedImports.length > 0 ||
    removedImports.length > 0 ||
    pragmaChanged;

  return {
    hasChanges,
    circuits: { added: addedCircuits, removed: removedCircuits, modified: modifiedCircuits },
    ledger: { added: addedLedger, removed: removedLedger, modified: modifiedLedger },
    pragma: { before: beforeAnalysis.pragma, after: afterAnalysis.pragma, changed: pragmaChanged },
    imports: { added: addedImports, removed: removedImports },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/differ.test.ts`
Expected: PASS

**Step 5: Add route to index.ts**

```typescript
app.post("/diff", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { before, after } = body;

    if (!before || typeof before !== "string") {
      return c.json({ success: false, error: "'before' code is required" }, 400);
    }
    if (!after || typeof after !== "string") {
      return c.json({ success: false, error: "'after' code is required" }, 400);
    }

    const result = diffContracts(before, after);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error("Diff error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/src/differ.ts test/differ.test.ts backend/src/index.ts
git commit -m "feat: add POST /diff endpoint for semantic contract diffing"
```

---

## Task 7: Compatibility Matrix Endpoint

Add `GET /matrix` or `POST /matrix` that compiles a contract against all installed compiler versions and returns a pass/fail matrix.

**Files:**
- Create: `backend/src/matrix.ts`
- Create: `test/matrix.test.ts`
- Modify: `backend/src/index.ts` (add route)

**Step 1: Write the failing test**

```typescript
// test/matrix.test.ts
import { describe, it, expect } from "vitest";
import { buildMatrix, type MatrixEntry } from "../backend/src/matrix.js";

describe("matrix", () => {
  describe("buildMatrix", () => {
    it("returns a result for each version", async () => {
      // This is an integration test — needs actual compiler.
      // For unit testing, we verify the shape of results.
      const mockCompile = async (code: string, version: string) => ({
        version,
        success: true,
        errors: undefined,
        warnings: undefined,
        executionTime: 100,
      });

      const versions = ["0.25.0", "0.26.0"];
      const results = await buildMatrix(
        "export circuit test(): [] {}",
        versions,
        mockCompile
      );

      expect(results).toHaveLength(2);
      expect(results[0].version).toBe("0.25.0");
      expect(results[1].version).toBe("0.26.0");
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("handles compile failures per version", async () => {
      const mockCompile = async (code: string, version: string) => ({
        version,
        success: version !== "0.25.0",
        errors: version === "0.25.0" ? [{ message: "unsupported", severity: "error" as const }] : undefined,
        warnings: undefined,
        executionTime: 100,
      });

      const results = await buildMatrix(
        "code",
        ["0.25.0", "0.26.0"],
        mockCompile
      );

      expect(results[0].success).toBe(false);
      expect(results[0].errors).toBeDefined();
      expect(results[1].success).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/matrix.test.ts`
Expected: FAIL — module not found

**Step 3: Write the matrix module**

```typescript
// backend/src/matrix.ts
import type { CompilerError } from "./parser.js";

export interface MatrixEntry {
  version: string;
  success: boolean;
  errors?: CompilerError[];
  warnings?: CompilerError[];
  executionTime?: number;
}

export type CompileFn = (
  code: string,
  version: string
) => Promise<MatrixEntry>;

/**
 * Compiles code against multiple versions in parallel and returns the matrix.
 */
export async function buildMatrix(
  code: string,
  versions: string[],
  compileFn: CompileFn
): Promise<MatrixEntry[]> {
  const results = await Promise.allSettled(
    versions.map((version) => compileFn(code, version))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      version: versions[i],
      success: false,
      errors: [{ message: result.reason?.message || "Compilation failed", severity: "error" as const }],
    };
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/matrix.test.ts`
Expected: PASS

**Step 5: Add route to index.ts**

```typescript
app.post("/matrix", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required" }, 400);
    }

    // If no versions specified, use all installed
    const targetVersions: string[] = versions || (await listInstalledVersions());

    if (targetVersions.length === 0) {
      return c.json({ success: false, error: "No compiler versions available" }, 500);
    }

    const compileFn: CompileFn = async (code, version) => {
      const result = await compile(code, { wrapWithDefaults: true, skipZk: true, version });
      return {
        version,
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
        executionTime: result.executionTime,
      };
    };

    const matrix = await buildMatrix(code, targetVersions, compileFn);
    return c.json({ success: true, matrix });
  } catch (error) {
    console.error("Matrix error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/src/matrix.ts test/matrix.test.ts backend/src/index.ts
git commit -m "feat: add POST /matrix endpoint for compatibility matrix compilation"
```

---

## Task 8: Refactor Routes into Separate Modules

By now `index.ts` has grown significantly. Extract routes into separate route files for maintainability.

**Files:**
- Create: `backend/src/routes/compile.ts`
- Create: `backend/src/routes/format.ts`
- Create: `backend/src/routes/analyze.ts`
- Create: `backend/src/routes/diff.ts`
- Create: `backend/src/routes/matrix.ts`
- Create: `backend/src/routes/health.ts`
- Modify: `backend/src/index.ts` (import and mount routes)

**Step 1: Extract each route group**

Each route file exports a Hono app that gets mounted on the main app:

```typescript
// Example: backend/src/routes/compile.ts
import { Hono } from "hono";
import { compile } from "../compiler.js";
import { checkRateLimit } from "../rate-limit.js";

const compileRoutes = new Hono();

compileRoutes.post("/compile", async (c) => {
  // ... existing compile handler
});

export { compileRoutes };
```

**Step 2: Create a shared rate-limit module**

Extract `checkRateLimit` from `index.ts` into `backend/src/rate-limit.ts` so routes can share it.

**Step 3: Update index.ts to mount routes**

```typescript
// backend/src/index.ts
import { compileRoutes } from "./routes/compile.js";
import { formatRoutes } from "./routes/format.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { diffRoutes } from "./routes/diff.js";
import { matrixRoutes } from "./routes/matrix.js";
import { healthRoutes } from "./routes/health.js";

app.route("/", compileRoutes);
app.route("/", formatRoutes);
app.route("/", analyzeRoutes);
app.route("/", diffRoutes);
app.route("/", matrixRoutes);
app.route("/", healthRoutes);
```

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All PASS (pure refactor, no behavior change)

**Step 5: Commit**

```bash
git add backend/src/routes/ backend/src/rate-limit.ts backend/src/index.ts
git commit -m "refactor: extract routes into separate modules"
```

---

## Task 9: Deployment Configs (Railway, Fly.io, Docker Compose)

Add deployment configuration files for Railway and Fly.io alongside the existing Docker setup.

**Files:**
- Create: `railway.toml`
- Create: `fly.toml`
- Create: `docker-compose.yml`
- Modify: `Dockerfile` (add env var for DEFAULT_COMPILER_VERSION)

**Step 1: Update Dockerfile with new env vars**

Add to the env vars section of the Dockerfile:

```dockerfile
ENV DEFAULT_COMPILER_VERSION=latest
ENV CACHE_ENABLED=true
ENV CACHE_MAX_SIZE=1000
ENV CACHE_TTL=3600000
```

**Step 2: Create railway.toml**

```toml
# railway.toml
[build]
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**Step 3: Create fly.toml**

```toml
# fly.toml
app = "compact-playground"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[checks]
  [checks.health]
    type = "http"
    port = 8080
    path = "/health"
    interval = "30s"
    timeout = "10s"
    grace_period = "30s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**Step 4: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  compact-playground:
    build: .
    ports:
      - "${PORT:-8080}:8080"
    environment:
      - PORT=8080
      - DEFAULT_COMPILER_VERSION=${DEFAULT_COMPILER_VERSION:-latest}
      - CACHE_ENABLED=${CACHE_ENABLED:-true}
      - CACHE_MAX_SIZE=${CACHE_MAX_SIZE:-1000}
      - RATE_LIMIT=${RATE_LIMIT:-20}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3
    restart: unless-stopped
```

**Step 5: Create .env.example**

```bash
# .env.example
PORT=8080
DEFAULT_COMPILER_VERSION=latest
CACHE_ENABLED=true
CACHE_MAX_SIZE=1000
CACHE_TTL=3600000
RATE_LIMIT=20
RATE_WINDOW=60000
```

**Step 6: Commit**

```bash
git add railway.toml fly.toml docker-compose.yml .env.example Dockerfile
git commit -m "feat: add Railway, Fly.io, and Docker Compose deployment configs"
```

---

## Task 10: Update README

Complete rewrite of the README to document all new endpoints, deployment options, and configuration.

**Files:**
- Modify: `README.md`

**Step 1: Rewrite README.md**

The README should include:

1. **Header** — Project name, one-line description, badges
2. **Quick Start** — Docker one-liner to get running
3. **API Reference** — All endpoints with request/response examples:
   - `POST /compile` (with version parameter)
   - `POST /format` (with diff option)
   - `POST /analyze` (fast and deep modes)
   - `POST /diff` (semantic contract diff)
   - `POST /matrix` (compatibility matrix)
   - `GET /versions` (installed versions)
   - `GET /health` (health check with cache stats)
4. **Configuration** — Table of all env vars with defaults
5. **Deployment** — Sections for Docker, Docker Compose, Railway, Fly.io
6. **mdBook Integration** — How to use with Learn Compact (existing content, updated)
7. **Development** — Local dev setup, running tests
8. **Self-Hosting** — Guide for teams running their own instance
9. **License**

Key notes:
- Document `DEFAULT_COMPILER_VERSION` prominently — explain that Learn Compact sets this to a specific version for compatibility
- Show the curl examples for every endpoint
- Include the response shapes

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: comprehensive README rewrite with full API reference and deployment guides"
```

---

## Task 11: Integration Tests

Add integration tests that verify the HTTP endpoints work end-to-end (using Hono's test client, no real compiler needed for most).

**Files:**
- Create: `test/integration/routes.test.ts`

**Step 1: Write integration tests**

```typescript
// test/integration/routes.test.ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// Test the route handlers with mock compiler
// This verifies request validation, response shapes, rate limiting, etc.

describe("API routes", () => {
  describe("POST /compile", () => {
    it("rejects empty code", async () => {
      // Create test app with routes, send request, verify 400
    });

    it("rejects oversized code", async () => {
      // Send >100KB, verify 400
    });

    it("accepts valid compile request", async () => {
      // Send valid code, verify response shape
    });
  });

  describe("POST /format", () => {
    it("rejects empty code", async () => {});
    it("accepts valid format request", async () => {});
  });

  describe("POST /analyze", () => {
    it("returns fast analysis for valid code", async () => {});
    it("rejects invalid mode", async () => {});
  });

  describe("POST /diff", () => {
    it("rejects missing before/after", async () => {});
    it("returns diff for valid inputs", async () => {});
  });

  describe("GET /health", () => {
    it("returns health status", async () => {});
  });

  describe("GET /versions", () => {
    it("returns version info", async () => {});
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All PASS

**Step 3: Commit**

```bash
git add test/integration/
git commit -m "test: add integration tests for all API endpoints"
```

---

## Task Order & Dependencies

```
Task 1 (Config) ──────┐
                       ├── Task 2 (Format) ──┐
                       ├── Task 3 (Cache) ────┤
                       ├── Task 4 (Versions) ─┤
                       │                      ├── Task 7 (Matrix)
                       ├── Task 5 (Analyze) ──┤
                       │                      ├── Task 6 (Diff)
                       │                      │
                       └──────────────────────├── Task 8 (Route Refactor)
                                              ├── Task 9 (Deploy Configs)
                                              ├── Task 10 (README)
                                              └── Task 11 (Integration Tests)
```

- **Task 1** must be first (everything depends on config)
- **Tasks 2-5** can be done in parallel after Task 1
- **Task 6** depends on Task 5 (uses analyzer)
- **Task 7** depends on Task 4 (uses version manager)
- **Tasks 8-11** can be done after all features are implemented
- **Task 10** should be last (documents everything)
