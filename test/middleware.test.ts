import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { runMultiVersion, validateRequestBody } from "../backend/src/middleware.js";
import { HAS_COMPACT_CLI } from "./helpers.js";

describe.skipIf(!HAS_COMPACT_CLI)("runMultiVersion", () => {
  it("executes operation for each resolved version", async () => {
    const executor = (version: string) =>
      Promise.resolve({
        success: true,
        output: `compiled with ${version}`,
      });

    const result = await runMultiVersion(["0.29.0", "0.28.0"], "code", executor);

    expect(result).toHaveLength(2);
    expect(result[0].version).toBe("0.29.0");
    expect(result[0].requestedVersion).toBe("0.29.0");
    expect(result[0].success).toBe(true);
  });

  it("handles mixed fulfilled and rejected results", async () => {
    const executor = (version: string) => {
      if (version === "0.28.0") return Promise.reject(new Error("Compiler not found"));
      return Promise.resolve({ success: true });
    };

    const result = await runMultiVersion(["0.29.0", "0.28.0"], "code", executor);

    expect(result).toHaveLength(2);
    expect(result[0].success).toBe(true);
    expect(result[1].success).toBe(false);
    expect(result[1].error).toBe("Compiler not found");
  });

  it("preserves requestedVersion vs resolved version", async () => {
    const executor = () => Promise.resolve({ success: true });

    const result = await runMultiVersion(["0.29.0"], "code", executor);

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
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Code too large");
  });

  it("rejects versions array exceeding limit", async () => {
    const app = createApp();
    const versions = Array.from({ length: 15 }, (_, i) => `0.${String(i)}.0`);
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test", versions }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
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
    const body = (await res.json()) as Record<string, unknown>;
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
