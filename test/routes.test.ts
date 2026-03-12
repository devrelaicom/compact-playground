import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../backend/src/compiler.js", () => ({
  compile: vi.fn(),
}));

vi.mock("../backend/src/formatter.js", () => ({
  formatCode: vi.fn(),
}));

vi.mock("../backend/src/analysis/index.js", () => ({
  analyzeContract: vi.fn(),
}));

vi.mock("../backend/src/differ.js", () => ({
  diffContracts: vi.fn(),
}));

vi.mock("../backend/src/rate-limit.js", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "test-ip"),
}));

vi.mock("../backend/src/utils.js", () => ({
  getCompilerVersion: vi.fn(),
}));

vi.mock("../backend/src/config.js", () => ({
  getConfig: vi.fn(() => ({
    defaultCompilerVersion: "latest",
    cacheEnabled: false,
  })),
  resetConfig: vi.fn(),
}));

vi.mock("../backend/src/cache.js", () => ({
  getFileCache: vi.fn(() => null),
  generateCacheKey: vi.fn(() => "mock-key"),
  resetFileCache: vi.fn(),
}));

vi.mock("../backend/src/version-manager.js", () => ({
  listInstalledVersions: vi.fn(),
  buildLanguageVersionMap: vi.fn(),
  resolveVersion: vi.fn(),
  getDefaultVersion: vi.fn(),
}));

vi.mock("../backend/src/middleware.js", () => ({
  runMultiVersion: vi.fn(),
}));

import { compile } from "../backend/src/compiler.js";
import { formatCode } from "../backend/src/formatter.js";
import { analyzeContract } from "../backend/src/analysis/index.js";
import { diffContracts } from "../backend/src/differ.js";
import { checkRateLimit, getClientIp } from "../backend/src/rate-limit.js";
import { getCompilerVersion } from "../backend/src/utils.js";
import { getConfig } from "../backend/src/config.js";
import {
  listInstalledVersions,
  buildLanguageVersionMap,
  resolveVersion,
  getDefaultVersion,
} from "../backend/src/version-manager.js";
import { runMultiVersion } from "../backend/src/middleware.js";

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;

import { compileRoutes } from "../backend/src/routes/compile.js";
import { formatRoutes } from "../backend/src/routes/format.js";
import { analyzeRoutes } from "../backend/src/routes/analyze.js";
import { diffRoutes } from "../backend/src/routes/diff.js";
import { healthRoutes, warmVersionsCache } from "../backend/src/routes/health.js";

const mockCompile = compile as ReturnType<typeof vi.fn>;
const mockFormatCode = formatCode as ReturnType<typeof vi.fn>;
const mockAnalyzeContract = analyzeContract as ReturnType<typeof vi.fn>;
const mockDiffContracts = diffContracts as ReturnType<typeof vi.fn>;
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>;
const mockGetClientIp = getClientIp as ReturnType<typeof vi.fn>;
const mockGetCompilerVersion = getCompilerVersion as ReturnType<typeof vi.fn>;
const mockListInstalledVersions = listInstalledVersions as ReturnType<typeof vi.fn>;
const mockBuildLanguageVersionMap = buildLanguageVersionMap as ReturnType<typeof vi.fn>;
const mockResolveVersion = resolveVersion as ReturnType<typeof vi.fn>;
const mockRunMultiVersion = runMultiVersion as ReturnType<typeof vi.fn>;
const mockGetDefaultVersion = getDefaultVersion as ReturnType<typeof vi.fn>;

function createApp() {
  const app = new Hono();
  app.route("/", compileRoutes);
  app.route("/", formatRoutes);
  app.route("/", analyzeRoutes);
  app.route("/", diffRoutes);
  app.route("/", healthRoutes);
  return app;
}

describe("POST /compile", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
    mockGetClientIp.mockReturnValue("test-ip");
    app = createApp();
  });

  it("valid code → 200, returns compile result", async () => {
    const compileResult = {
      success: true,
      output: "compiled output",
      compiledAt: "2024-01-01T00:00:00Z",
      executionTime: 100,
    };
    mockCompile.mockResolvedValue(compileResult);

    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.output).toBe("compiled output");
    expect(mockCompile).toHaveBeenCalledWith("export circuit test(): [] {}", {});
  });

  it("missing code → 400 with validation error", async () => {
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: {} }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid request");
  });

  it("rate limited → 429 'Rate limit exceeded'", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}" }),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Rate limit exceeded");
  });

  it("with versions array → 200, calls runMultiVersion", async () => {
    const multiVersionResults = [
      { version: "0.29.0", requestedVersion: "0.29.0", success: true },
      { version: "0.28.0", requestedVersion: "0.28.0", success: true },
    ];
    mockRunMultiVersion.mockResolvedValue(multiVersionResults);

    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "export circuit test(): [] {}",
        versions: ["0.29.0", "0.28.0"],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.results).toEqual(multiVersionResults);
    expect(mockRunMultiVersion).toHaveBeenCalled();
  });
});

describe("POST /format", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
    mockGetClientIp.mockReturnValue("test-ip");
    app = createApp();
  });

  it("valid code → 200, returns format result", async () => {
    const formatResult = { success: true, formatted: "formatted code" };
    mockFormatCode.mockResolvedValue(formatResult);

    const res = await app.request("/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.formatted).toBe("formatted code");
  });

  it("missing code → 400", async () => {
    const res = await app.request("/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: {} }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it("rate limited → 429", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const res = await app.request("/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}" }),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Rate limit exceeded");
  });
});

describe("POST /analyze", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
    mockGetClientIp.mockReturnValue("test-ip");
    app = createApp();
  });

  it("mode=fast → 200, returns canonical analysis response", async () => {
    const analysisResult = {
      success: true,
      mode: "fast",
      diagnostics: [],
      summary: {
        hasLedger: false,
        hasCircuits: true,
        hasWitnesses: false,
        totalLines: 1,
        publicCircuits: 1,
        privateCircuits: 0,
        publicState: 0,
        privateState: 0,
      },
      structure: {
        imports: [],
        exports: ["test"],
        ledger: [],
        circuits: [
          {
            name: "test",
            isPublic: true,
            isPure: false,
            parameters: [],
            returnType: "[]",
            location: { line: 1, column: 0, offset: 0 },
          },
        ],
        witnesses: [],
        types: [],
      },
      facts: { hasStdLibImport: false, unusedWitnesses: [] },
      findings: [],
      recommendations: [],
      circuits: [],
    };
    mockAnalyzeContract.mockResolvedValue(analysisResult);

    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}", mode: "fast" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.mode).toBe("fast");
    expect(body.summary).toBeDefined();
    expect(body.structure).toBeDefined();
    expect(body.findings).toBeDefined();
    expect(body.recommendations).toBeDefined();
  });

  it("mode=deep → 200, returns analysis with compilation", async () => {
    const analysisResult = {
      success: true,
      mode: "deep",
      diagnostics: [],
      summary: {
        hasLedger: false,
        hasCircuits: true,
        hasWitnesses: false,
        totalLines: 1,
        publicCircuits: 1,
        privateCircuits: 0,
        publicState: 0,
        privateState: 0,
      },
      structure: { imports: [], exports: [], ledger: [], circuits: [], witnesses: [], types: [] },
      facts: { hasStdLibImport: false, unusedWitnesses: [] },
      findings: [],
      recommendations: [],
      circuits: [],
      compilation: { success: true, diagnostics: [], executionTime: 50 },
      compiler: { available: true, executionTime: 50 },
    };
    mockAnalyzeContract.mockResolvedValue(analysisResult);

    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}", mode: "deep" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.mode).toBe("deep");
    expect(body.compilation).toBeDefined();
  });

  it("invalid mode → 400 with validation error", async () => {
    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}", mode: "invalid" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid request");
  });

  it("missing code → 400", async () => {
    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fast" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it("rate limited → 429", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test", mode: "fast" }),
    });

    expect(res.status).toBe(429);
  });

  it("accepts circuit filter parameter", async () => {
    mockAnalyzeContract.mockResolvedValue({ success: true, mode: "fast", circuits: [] });

    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test", mode: "fast", circuit: "myCircuit" }),
    });

    expect(res.status).toBe(200);
    expect(mockAnalyzeContract).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ circuit: "myCircuit" }),
    );
  });
});

describe("POST /diff", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
    mockGetClientIp.mockReturnValue("test-ip");
    app = createApp();
  });

  it("valid before+after → 200", async () => {
    const diffResult = { changes: [], linesAdded: 0, linesRemoved: 0 };
    mockDiffContracts.mockResolvedValue(diffResult);

    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "old code", after: "new code" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  it("missing before → 400 with validation error", async () => {
    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ after: "new code" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid request");
  });

  it("missing after → 400 with validation error", async () => {
    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "old code" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid request");
  });

  it("rate limited → 429", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "old code", after: "new code" }),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Rate limit exceeded");
  });
});

describe("GET /health", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConfig.mockReturnValue({ defaultCompilerVersion: "latest" });
    app = createApp();
  });

  it("returns status, compactCli, defaultVersion, timestamp", async () => {
    mockGetCompilerVersion.mockResolvedValue("0.29.0");
    mockListInstalledVersions.mockResolvedValue(["0.29.0", "0.28.0"]);
    mockGetDefaultVersion.mockResolvedValue("0.29.0");

    const res = await app.request("/health", { method: "GET" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.compactCli).toBeDefined();
    const compactCli = body.compactCli as Record<string, unknown>;
    expect(compactCli.installed).toBe(true);
    expect(compactCli.version).toBe("0.29.0");
    expect(body.defaultVersion).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });
});

describe("GET /versions", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    app = createApp();
  });

  it("returns default + installed with language versions", async () => {
    mockListInstalledVersions.mockResolvedValue(["0.29.0", "0.28.0"]);
    mockResolveVersion.mockReturnValue("0.29.0");
    mockBuildLanguageVersionMap.mockResolvedValue(
      new Map([
        ["0.29.0", "1.0"],
        ["0.28.0", "0.9"],
      ]),
    );

    // Warm the cache before requesting (simulates startup)
    await warmVersionsCache();

    const res = await app.request("/versions", { method: "GET" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.default).toBe("0.29.0");
    expect(Array.isArray(body.installed)).toBe(true);
    const installed = body.installed as Array<Record<string, unknown>>;
    expect(installed).toHaveLength(2);
    expect(installed[0].version).toBe("0.29.0");
    expect(installed[0].languageVersion).toBe("1.0");
  });
});
