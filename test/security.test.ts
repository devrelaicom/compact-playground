import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../backend/src/compiler.js", () => ({
  compile: vi.fn(),
}));

vi.mock("../backend/src/formatter.js", () => ({
  formatCode: vi.fn(),
}));

vi.mock("../backend/src/differ.js", () => ({
  diffContracts: vi.fn(),
}));

vi.mock("../backend/src/analyzer.js", () => ({
  analyzeSource: vi.fn(),
}));

vi.mock("../backend/src/rate-limit.js", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "test-ip"),
}));

vi.mock("../backend/src/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Keep the real validateRequestBody
  };
});

import { checkRateLimit } from "../backend/src/rate-limit.js";
import { validateRequestBody } from "../backend/src/middleware.js";
import { compileRoutes } from "../backend/src/routes/compile.js";
import { formatRoutes } from "../backend/src/routes/format.js";
import { analyzeRoutes } from "../backend/src/routes/analyze.js";
import { diffRoutes } from "../backend/src/routes/diff.js";

const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>;

function createApp() {
  const app = new Hono();
  app.use("*", validateRequestBody);
  app.route("/", compileRoutes);
  app.route("/", formatRoutes);
  app.route("/", analyzeRoutes);
  app.route("/", diffRoutes);
  return app;
}

describe("malformed JSON handling", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
    app = createApp();
  });

  it("POST /compile with invalid JSON → 400", async () => {
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is not json{{{",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid JSON");
  });

  it("POST /format with invalid JSON → 400", async () => {
    const res = await app.request("/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid JSON");
  });

  it("POST /analyze with invalid JSON → 400", async () => {
    const res = await app.request("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid JSON");
  });

  it("POST /diff with invalid JSON → 400", async () => {
    const res = await app.request("/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[unclosed",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid JSON");
  });
});
