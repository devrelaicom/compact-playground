import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { runMultiVersion, validateRequestBody } from "../backend/src/middleware.js";

describe("runMultiVersion", () => {
  it("executes operation for each resolved version", async () => {
    const executor = (version: string) =>
      Promise.resolve({
        success: true,
        output: `compiled with ${version}`,
      });

    const result = await runMultiVersion(["0.29.0"], "code", executor);

    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("0.29.0");
    expect(result[0].requestedVersion).toBe("0.29.0");
    expect(result[0].success).toBe(true);
  });

  it("handles uninstalled version as rejection", async () => {
    const executor = () => Promise.resolve({ success: true });

    // 0.99.0 is not installed, so resolveRequestedVersion will throw
    await expect(runMultiVersion(["0.29.0", "0.99.0"], "code", executor)).rejects.toThrow(
      /not installed/,
    );
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

  it("rejects versions array exceeding limit of 3", async () => {
    const app = createApp();
    const versions = ["0.28.0", "0.29.0", "0.30.0", "0.26.0"];
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test", versions }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Too many versions");
    expect(body.message).toBe("Maximum 3 versions per request");
  });

  it("allows exactly 3 versions", async () => {
    const app = createApp();
    const versions = ["0.28.0", "0.29.0", "0.30.0"];
    const res = await app.request("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test", versions }),
    });
    expect(res.status).toBe(200);
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
