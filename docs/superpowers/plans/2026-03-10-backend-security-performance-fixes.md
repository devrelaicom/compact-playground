# Backend Security, Performance & Quality Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 issues from PR #1 review: command injection, unbounded arrays, formatter perf, unused cache, settled guard, missing validation, IP spoofing, and duplicated multi-version logic.

**Architecture:** Add validation at the version-manager boundary (semver check) and API boundary (Hono middleware for size/array limits). Extract duplicated route logic into shared helpers. Wire up the existing CompileCache. Fix formatter to reuse cached version directories via `ensureVersion()`.

**Tech Stack:** TypeScript, Hono (web framework), Vitest (testing), Node.js child_process

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `backend/src/config.ts` | Centralized config with `maxVersionsPerRequest`, `maxCodeSize` | Modify |
| `backend/src/rate-limit.ts` | Rate limiting + `getClientIp()` helper | Modify |
| `backend/src/version-manager.ts` | Version validation in `resolveRequestedVersion` | Modify |
| `backend/src/middleware.ts` | Request validation middleware + `runMultiVersion()` helper | **Create** |
| `backend/src/index.ts` | Mount validation middleware | Modify |
| `backend/src/routes/compile.ts` | Use shared helpers, remove inline checks | Modify |
| `backend/src/routes/format.ts` | Use shared helpers, remove inline checks | Modify |
| `backend/src/routes/analyze.ts` | Use shared helpers, remove inline checks | Modify |
| `backend/src/routes/diff.ts` | Use `getClientIp` | Modify |
| `backend/src/formatter.ts` | Use `ensureVersion()`, add settled guard | Modify |
| `backend/src/compiler.ts` | Wire up `CompileCache` | Modify |
| `test/version-manager.test.ts` | Tests for invalid version rejection | Modify |
| `test/rate-limit.test.ts` | Tests for `getClientIp` | **Create** |
| `test/middleware.test.ts` | Tests for `runMultiVersion` + `validateRequestBody` | **Create** |

---

## Chunk 1: Security Hardening (Issues #1, #7)

### Task 1: Validate version strings in `resolveRequestedVersion`

**Files:**
- Modify: `backend/src/version-manager.ts:255-273`
- Test: `test/version-manager.test.ts`

Note: The "latest" and "detect" branches return early via internal resolution (`listInstalledVersions` / `detectVersionFromPragma`) and never pass user input directly to subprocesses. Only the pass-through path (line 272) needs validation.

- [ ] **Step 1: Write the failing tests**

In `test/version-manager.test.ts`, add `resolveRequestedVersion` to the import:

```typescript
import {
  parseVersionString,
  isValidVersion,
  compareVersions,
  resolveVersion,
  resolveRequestedVersion,
} from "../backend/src/version-manager.js";
```

Add a new describe block at the end of the file (after the `resolveVersion` describe):

```typescript
describe("resolveRequestedVersion", () => {
  it("rejects path traversal strings", async () => {
    await expect(
      resolveRequestedVersion("../../etc/passwd", "")
    ).rejects.toThrow("Invalid version format");
  });

  it("rejects command injection strings", async () => {
    await expect(
      resolveRequestedVersion("1.0.0; rm -rf /", "")
    ).rejects.toThrow("Invalid version format");
  });

  it("rejects empty strings", async () => {
    await expect(
      resolveRequestedVersion("", "")
    ).rejects.toThrow("Invalid version format");
  });

  it("rejects partial versions", async () => {
    await expect(
      resolveRequestedVersion("0.26", "")
    ).rejects.toThrow("Invalid version format");
  });

  it("accepts valid semver strings", async () => {
    const result = await resolveRequestedVersion("0.29.0", "");
    expect(result).toBe("0.29.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/version-manager.test.ts`
Expected: 4 tests fail (path traversal, injection, empty, partial pass through without error), 1 passes (valid semver)

- [ ] **Step 3: Add validation to `resolveRequestedVersion`**

In `backend/src/version-manager.ts`, replace the final `return version;` on line 272 with:

```typescript
  if (!isValidVersion(version)) {
    throw new Error(
      `Invalid version format: ${version}. Expected semver like "0.29.0"`
    );
  }

  return version;
```

`isValidVersion()` at line 22 uses regex `^\d+\.\d+\.\d+$` — blocks path traversal, injection, and malformed input.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/version-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
git add backend/src/version-manager.ts test/version-manager.test.ts
git commit -m "fix: validate version strings in resolveRequestedVersion to prevent injection"
```

---

### Task 2: Extract `getClientIp` helper with proper `x-forwarded-for` parsing

**Files:**
- Modify: `backend/src/rate-limit.ts`
- Create: `test/rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/rate-limit.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/rate-limit.test.ts`
Expected: FAIL — `getClientIp` is not exported

- [ ] **Step 3: Implement `getClientIp`**

In `backend/src/rate-limit.ts`, add the import at the top of the file (after the existing import):

```typescript
import type { Context } from "hono";
```

Add the function at the end of the file after `checkRateLimit`:

```typescript
/**
 * Extracts client IP from request headers.
 * Takes the first IP from x-forwarded-for (client IP before proxies),
 * falls back to x-real-ip, then "unknown".
 */
export function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return c.req.header("x-real-ip") || "unknown";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/rate-limit.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```
git add backend/src/rate-limit.ts test/rate-limit.test.ts
git commit -m "fix: extract getClientIp with proper x-forwarded-for parsing"
```

---

## Chunk 2: Shared Middleware & Multi-Version Helper (Issues #2, #6, #8)

### Task 3: Add config constants for limits

**Files:**
- Modify: `backend/src/config.ts`

- [ ] **Step 1: Add `maxVersionsPerRequest` and `maxCodeSize` to Config**

In `backend/src/config.ts`, add to the `Config` interface (after `cacheTtl`):

```typescript
  maxVersionsPerRequest: number;
  maxCodeSize: number;
```

Add to the defaults in `getConfig()` (after the `cacheTtl` line):

```typescript
    maxVersionsPerRequest: parseInt(process.env.MAX_VERSIONS_PER_REQUEST || "10", 10),
    maxCodeSize: parseInt(process.env.MAX_CODE_SIZE || String(100 * 1024), 10),
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run test/config.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
git add backend/src/config.ts
git commit -m "feat: add maxVersionsPerRequest and maxCodeSize to config"
```

---

### Task 4: Create shared middleware and `runMultiVersion` helper

**Files:**
- Create: `backend/src/middleware.ts`
- Create: `test/middleware.test.ts`

Dependency: Task 1 must be done first (tests use `resolveRequestedVersion` which now validates versions).

- [ ] **Step 1: Write the failing tests**

Create `test/middleware.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { runMultiVersion, validateRequestBody } from "../backend/src/middleware.js";

describe("runMultiVersion", () => {
  it("executes operation for each resolved version", async () => {
    const executor = async (version: string) => ({
      success: true,
      output: `compiled with ${version}`,
    });

    const result = await runMultiVersion(
      ["0.29.0", "0.28.0"],
      "code",
      executor
    );

    expect(result).toHaveLength(2);
    expect(result[0].version).toBe("0.29.0");
    expect(result[0].requestedVersion).toBe("0.29.0");
    expect(result[0].success).toBe(true);
  });

  it("handles mixed fulfilled and rejected results", async () => {
    const executor = async (version: string) => {
      if (version === "0.28.0") throw new Error("Compiler not found");
      return { success: true };
    };

    const result = await runMultiVersion(
      ["0.29.0", "0.28.0"],
      "code",
      executor
    );

    expect(result).toHaveLength(2);
    expect(result[0].success).toBe(true);
    expect(result[1].success).toBe(false);
    expect(result[1].error).toBe("Compiler not found");
  });

  it("preserves requestedVersion vs resolved version", async () => {
    const executor = async (version: string) => ({ success: true });

    const result = await runMultiVersion(
      ["0.29.0"],
      "code",
      executor
    );

    expect(result[0].requestedVersion).toBe("0.29.0");
    expect(result[0].version).toBe("0.29.0");
  });
});

describe("validateRequestBody", () => {
  function createApp() {
    const app = new Hono();
    app.use("*", validateRequestBody);
    app.post("/compile", (c) => c.json({ success: true }));
    app.post("/diff", (c) => c.json({ success: true }));
    app.get("/health", (c) => c.json({ status: "ok" }));
    return app;
  }

  it("rejects code larger than maxCodeSize", async () => {
    const app = createApp();
    const largeCode = "x".repeat(200 * 1024);
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: largeCode }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Code too large");
  });

  it("rejects versions array exceeding limit", async () => {
    const app = createApp();
    const versions = Array.from({ length: 15 }, (_, i) => `0.${i}.0`);
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test", versions }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Too many versions");
  });

  it("rejects oversized 'before' in /diff", async () => {
    const app = createApp();
    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "x".repeat(200 * 1024), after: "y" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Code too large");
  });

  it("allows valid requests through", async () => {
    const app = createApp();
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "valid code" }),
    });
    expect(res.status).toBe(200);
  });

  it("passes through GET requests without checking body", async () => {
    const app = createApp();
    const res = await app.request("/health", { method: "GET" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/middleware.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `middleware.ts`**

Create `backend/src/middleware.ts`:

```typescript
import type { Context, Next } from "hono";
import { getConfig } from "./config.js";
import { resolveRequestedVersion } from "./version-manager.js";

/**
 * Hono middleware that validates request bodies for POST endpoints.
 * Checks code size limits and versions array length.
 */
export async function validateRequestBody(c: Context, next: Next) {
  if (c.req.method !== "POST") {
    return next();
  }

  const config = getConfig();

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    // Let the route handler deal with JSON parse errors
    return next();
  }

  // Check code size
  if (typeof body.code === "string" && body.code.length > config.maxCodeSize) {
    return c.json(
      { success: false, error: "Code too large", message: `Code must be less than ${Math.floor(config.maxCodeSize / 1024)}KB` },
      400
    );
  }

  // Check before/after size (for /diff endpoint)
  if (typeof body.before === "string" && body.before.length > config.maxCodeSize) {
    return c.json(
      { success: false, error: "Code too large", message: `'before' code must be less than ${Math.floor(config.maxCodeSize / 1024)}KB` },
      400
    );
  }
  if (typeof body.after === "string" && body.after.length > config.maxCodeSize) {
    return c.json(
      { success: false, error: "Code too large", message: `'after' code must be less than ${Math.floor(config.maxCodeSize / 1024)}KB` },
      400
    );
  }

  // Check versions array length
  if (Array.isArray(body.versions) && body.versions.length > config.maxVersionsPerRequest) {
    return c.json(
      { success: false, error: "Too many versions", message: `Maximum ${config.maxVersionsPerRequest} versions per request` },
      400
    );
  }

  return next();
}

/**
 * Shared multi-version execution helper.
 * Resolves version strings, runs an operation per version via Promise.allSettled,
 * and maps results into a response array preserving executor result shape.
 */
export async function runMultiVersion<T extends Record<string, unknown>>(
  versions: string[],
  code: string,
  executor: (resolvedVersion: string) => Promise<T>
): Promise<(T & { version: string; requestedVersion: string; success: boolean; error?: string })[]> {
  const resolvedVersions = await Promise.all(
    versions.map((v: string) => resolveRequestedVersion(v, code))
  );

  const results = await Promise.allSettled(
    resolvedVersions.map((version: string) => executor(version))
  );

  return results.map((result, i) => {
    const requestedVersion = versions[i];
    const resolvedVersion = resolvedVersions[i];

    if (result.status === "fulfilled") {
      return {
        ...result.value,
        version: resolvedVersion,
        requestedVersion,
        success: result.value.success !== undefined ? (result.value.success as boolean) : true,
      };
    }

    return {
      version: resolvedVersion,
      requestedVersion,
      success: false,
      error: result.reason?.message || "Operation failed",
    } as T & { version: string; requestedVersion: string; success: boolean; error: string };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/middleware.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
git add backend/src/middleware.ts test/middleware.test.ts
git commit -m "feat: add request validation middleware and runMultiVersion helper"
```

---

### Task 5: Mount middleware and update routes

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/routes/compile.ts`
- Modify: `backend/src/routes/format.ts`
- Modify: `backend/src/routes/analyze.ts`
- Modify: `backend/src/routes/diff.ts`

- [ ] **Step 1: Mount validation middleware in `index.ts`**

Add import:

```typescript
import { validateRequestBody } from "./middleware.js";
```

Add after the `cors` `app.use(...)` block, before the `// Mount routes` comment:

```typescript
app.use("*", validateRequestBody);
```

- [ ] **Step 2: Update `compile.ts` to use shared helpers**

Replace the full file content of `backend/src/routes/compile.ts`:

```typescript
import { Hono } from "hono";
import { compile } from "../compiler.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";

const compileRoutes = new Hono();

compileRoutes.post("/compile", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json(
      { success: false, error: "Rate limit exceeded", message: "Too many requests. Please wait a minute before trying again." },
      429
    );
  }

  try {
    const body = await c.req.json();
    const { code, options = {}, versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Invalid request", message: "Code is required and must be a string" }, 400);
    }

    // Multi-version: compile against each version
    if (versions && Array.isArray(versions) && versions.length > 0) {
      const results = await runMultiVersion(versions, code, (version) =>
        compile(code, { ...options, version })
      );
      return c.json({ success: true, results });
    }

    // Single version (backward compatible): flat response
    const result = await compile(code, options);
    return c.json(result);
  } catch (error) {
    console.error("Compilation error:", error);
    return c.json(
      { success: false, error: "Internal server error", message: error instanceof Error ? error.message : "An unknown error occurred" },
      500
    );
  }
});

export { compileRoutes };
```

- [ ] **Step 3: Update `format.ts` to use shared helpers**

Replace the full file content of `backend/src/routes/format.ts`:

```typescript
import { Hono } from "hono";
import { formatCode } from "../formatter.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";

const formatRoutes = new Hono();

formatRoutes.post("/format", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, options = {}, versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required and must be a string" }, 400);
    }

    // Multi-version: format with each version
    if (versions && Array.isArray(versions) && versions.length > 0) {
      const results = await runMultiVersion(versions, code, (version) =>
        formatCode(code, { ...options, version })
      );
      return c.json({ success: true, results });
    }

    // Single version (backward compatible): flat response
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

export { formatRoutes };
```

- [ ] **Step 4: Update `analyze.ts` to use shared helpers**

Replace the full file content of `backend/src/routes/analyze.ts`:

```typescript
import { Hono } from "hono";
import { analyzeSource } from "../analyzer.js";
import { compile } from "../compiler.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import { runMultiVersion } from "../middleware.js";

const analyzeRoutes = new Hono();

analyzeRoutes.post("/analyze", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.json();
    const { code, mode = "fast", versions } = body;

    if (!code || typeof code !== "string") {
      return c.json({ success: false, error: "Code is required and must be a string" }, 400);
    }

    if (mode === "fast") {
      const analysis = analyzeSource(code);
      return c.json({ success: true, mode: "fast", ...analysis });
    }

    if (mode === "deep") {
      const analysis = analyzeSource(code);

      // Multi-version deep analysis
      if (versions && Array.isArray(versions) && versions.length > 0) {
        const compilations = await runMultiVersion(versions, code, async (version) => {
          const result = await compile(code, { wrapWithDefaults: true, skipZk: true, version });
          return {
            success: result.success,
            errors: result.errors,
            warnings: result.warnings,
            executionTime: result.executionTime,
          };
        });

        return c.json({
          success: true,
          mode: "deep",
          ...analysis,
          compilations,
        });
      }

      // Single version deep analysis (backward compatible)
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

export { analyzeRoutes };
```

- [ ] **Step 5: Update `diff.ts` to use `getClientIp`**

In `backend/src/routes/diff.ts`, make two changes:

Replace the import:
```
import { checkRateLimit } from "../rate-limit.js";
```
with:
```typescript
import { checkRateLimit, getClientIp } from "../rate-limit.js";
```

Replace lines 7-11 (the rate limit block):
```
diffRoutes.post("/diff", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }
```
with:
```typescript
diffRoutes.post("/diff", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }
```

- [ ] **Step 6: Run type check and all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Type check passes, all tests PASS

- [ ] **Step 7: Commit**

```
git add backend/src/index.ts backend/src/routes/compile.ts backend/src/routes/format.ts backend/src/routes/analyze.ts backend/src/routes/diff.ts
git commit -m "refactor: use shared middleware, getClientIp, and runMultiVersion across routes"
```

---

## Chunk 3: Module-Level Fixes (Issues #3, #4, #5)

### Task 6: Fix formatter to use `ensureVersion()` and add settled guard

**Files:**
- Modify: `backend/src/formatter.ts`

- [ ] **Step 1: Add `ensureVersion` import**

In `backend/src/formatter.ts`, replace the import on line 6:
```
import { getDefaultVersion } from "./version-manager.js";
```
with:
```typescript
import { getDefaultVersion, ensureVersion } from "./version-manager.js";
```

- [ ] **Step 2: Replace per-request `compact update` with `ensureVersion()`**

Replace lines 46-64 (from `// Install the resolved version` through the `formatArgs` assignment) with:

```typescript
    // Ensure the version is installed (cached across requests)
    let versionDir: string | null = null;
    if (version) {
      try {
        versionDir = await ensureVersion(version);
      } catch (err) {
        return {
          success: false,
          error: `Failed to ensure version ${version}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Build format args — use --directory when we have a version dir
    const formatArgs = versionDir
      ? ["format", "--directory", versionDir, sourceFile]
      : ["format", sourceFile];
```

- [ ] **Step 3: Add settled guard to `runFormatter`**

Replace the entire `runFormatter` function (lines 102-131 in the original, may have shifted after Step 2) with:

```typescript
function runFormatter(
  path: string,
  args: string[],
  timeout: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(path, args, {
      env: { ...process.env, TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("Formatting timed out"));
      }
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("compact CLI not found. Ensure it is installed and in PATH."));
        } else {
          reject(error);
        }
      }
    });
  });
}
```

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Type check passes, all tests PASS (existing formatter tests exercise `formatCode` end-to-end)

- [ ] **Step 5: Commit**

```
git add backend/src/formatter.ts
git commit -m "fix: use ensureVersion for cached formatter installs, add settled guard"
```

---

### Task 7: Wire up compilation cache

**Files:**
- Modify: `backend/src/compiler.ts`

- [ ] **Step 1: Add cache imports and singleton**

In `backend/src/compiler.ts`, add after the existing imports (after line 8):

```typescript
import { CompileCache, generateCacheKey } from "./cache.js";

let compileCache: CompileCache | null = null;

function getCache(): CompileCache | null {
  const config = getConfig();
  if (!config.cacheEnabled) return null;
  if (!compileCache) {
    compileCache = new CompileCache({
      maxSize: config.cacheMaxSize,
      ttl: config.cacheTtl,
    });
  }
  return compileCache;
}

/** Reset compile cache (for testing) */
export function resetCompileCache(): void {
  compileCache = null;
}
```

- [ ] **Step 2: Add cache check at the start of `compile()`**

In the `compile()` function, after `compilerVersion` is resolved (after the line `const compilerVersion = options.version || (await getDefaultVersion());`), add:

```typescript
    // Check cache before doing any work
    const cache = getCache();
    const cacheKey = cache
      ? generateCacheKey(
          code,
          compilerVersion || "default",
          { wrapWithDefaults: options.wrapWithDefaults, skipZk: options.skipZk }
        )
      : null;

    if (cache && cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        // Cache stores full CompileResult objects from successful compilations
        return cached as CompileResult;
      }
    }
```

- [ ] **Step 3: Store successful results in cache**

Replace the success branch (the `if (result.exitCode === 0) { ... }` block starting around line 94) with:

```typescript
    if (result.exitCode === 0) {
      // Success
      const warnings = parseCompilerErrors(result.stderr);
      const compileResult: CompileResult = {
        success: true,
        output: "Compilation successful",
        warnings: warnings.length > 0 ? warnings : undefined,
        compiledAt: new Date().toISOString(),
        originalCode: needsWrapping ? code : undefined,
        wrappedCode: needsWrapping ? finalCode : undefined,
        executionTime,
      };

      if (cache && cacheKey) {
        cache.set(cacheKey, compileResult);
      }

      return compileResult;
    }
```

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
git add backend/src/compiler.ts
git commit -m "feat: wire up CompileCache for compilation result caching"
```

---

## Chunk 4: Final Verification

### Task 8: Full verification pass

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: All tests PASS (existing 91 + new tests)

- [ ] **Step 3: Commit any remaining changes**

Run: `git status`
If clean, no action needed. If there are unstaged changes, review and commit.
