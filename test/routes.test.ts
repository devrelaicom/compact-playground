import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../backend/src/compiler.js", () => ({
  compile: vi.fn(),
}));

vi.mock("../backend/src/formatter.js", () => ({
  formatCode: vi.fn(),
}));

vi.mock("../backend/src/analyzer.js", () => ({
  analyzeSource: vi.fn(),
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
import { analyzeSource } from "../backend/src/analyzer.js";
import { diffContracts } from "../backend/src/differ.js";
import { checkRateLimit, getClientIp } from "../backend/src/rate-limit.js";
import { getCompilerVersion } from "../backend/src/utils.js";
import { listInstalledVersions, buildLanguageVersionMap, resolveVersion } from "../backend/src/version-manager.js";
import { runMultiVersion } from "../backend/src/middleware.js";

import { compileRoutes } from "../backend/src/routes/compile.js";
import { formatRoutes } from "../backend/src/routes/format.js";
import { analyzeRoutes } from "../backend/src/routes/analyze.js";
import { diffRoutes } from "../backend/src/routes/diff.js";
import { healthRoutes } from "../backend/src/routes/health.js";

const mockCompile = compile as ReturnType<typeof vi.fn>;
const mockFormatCode = formatCode as ReturnType<typeof vi.fn>;
const mockAnalyzeSource = analyzeSource as ReturnType<typeof vi.fn>;
const mockDiffContracts = diffContracts as ReturnType<typeof vi.fn>;
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>;
const mockGetClientIp = getClientIp as ReturnType<typeof vi.fn>;
const mockGetCompilerVersion = getCompilerVersion as ReturnType<typeof vi.fn>;
const mockListInstalledVersions = listInstalledVersions as ReturnType<typeof vi.fn>;
const mockBuildLanguageVersionMap = buildLanguageVersionMap as ReturnType<typeof vi.fn>;
const mockResolveVersion = resolveVersion as ReturnType<typeof vi.fn>;
const mockRunMultiVersion = runMultiVersion as ReturnType<typeof vi.fn>;

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
    const compileResult = { success: true, output: "compiled output", compiledAt: "2024-01-01T00:00:00Z", executionTime: 100 };
    mockCompile.mockResolvedValue(compileResult);

    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.output).toBe("compiled output");
    expect(mockCompile).toHaveBeenCalledWith("export circuit test(): [] {}", {});
  });

  it("missing code → 400 'Code is required and must be a string'", async () => {
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: {} }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.message).toBe("Code is required and must be a string");
  });

  it("rate limited → 429 'Rate limit exceeded'", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}" }),
    });

    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
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
      body: JSON.stringify({ code: "export circuit test(): [] {}", versions: ["0.29.0", "0.28.0"] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
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
    const body = await res.json() as Record<string, unknown>;
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
    const body = await res.json() as Record<string, unknown>;
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
    const body = await res.json() as Record<string, unknown>;
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

  it("mode=fast → 200, returns analysis (no compile call)", async () => {
    const analysisResult = { declarations: [], imports: [], exports: [] };
    mockAnalyzeSource.mockReturnValue(analysisResult);

    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}", mode: "fast" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.mode).toBe("fast");
    expect(mockCompile).not.toHaveBeenCalled();
  });

  it("mode=deep → 200, returns analysis + compilation", async () => {
    const analysisResult = { declarations: [], imports: [], exports: [] };
    mockAnalyzeSource.mockReturnValue(analysisResult);
    const compileResult = { success: true, errors: [], warnings: [], executionTime: 50 };
    mockCompile.mockResolvedValue(compileResult);

    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}", mode: "deep" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.mode).toBe("deep");
    expect(body.compilation).toBeDefined();
    expect(mockCompile).toHaveBeenCalled();
  });

  it("invalid mode → 400 'Invalid mode'", async () => {
    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "export circuit test(): [] {}", mode: "invalid" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid mode");
  });

  it("missing code → 400", async () => {
    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fast" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
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
    mockDiffContracts.mockReturnValue(diffResult);

    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "old code", after: "new code" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  it("missing before → 400 \"'before' code is required\"", async () => {
    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ after: "new code" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("'before' code is required");
  });

  it("missing after → 400 \"'after' code is required\"", async () => {
    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "old code" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("'after' code is required");
  });

  it("rate limited → 429", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: "old code", after: "new code" }),
    });

    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Rate limit exceeded");
  });
});

describe("GET /health", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    app = createApp();
  });

  it("returns status, compactCli, timestamp", async () => {
    mockGetCompilerVersion.mockResolvedValue("0.29.0");

    const res = await app.request("/health", { method: "GET" });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.compactCli).toBeDefined();
    const compactCli = body.compactCli as Record<string, unknown>;
    expect(compactCli.installed).toBe(true);
    expect(compactCli.version).toBe("0.29.0");
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
    mockBuildLanguageVersionMap.mockResolvedValue(new Map([["0.29.0", "1.0"], ["0.28.0", "0.9"]]));

    const res = await app.request("/versions", { method: "GET" });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.default).toBe("0.29.0");
    expect(Array.isArray(body.installed)).toBe(true);
    const installed = body.installed as Array<Record<string, unknown>>;
    expect(installed).toHaveLength(2);
    expect(installed[0].version).toBe("0.29.0");
    expect(installed[0].languageVersion).toBe("1.0");
  });
});
