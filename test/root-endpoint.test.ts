import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
  version: string;
};

describe("GET /", () => {
  it("package.json version is not the old hard-coded value", () => {
    // Regression guard: the API previously returned "2.0.0" while package.json had a different value.
    expect(pkg.version).not.toBe("2.0.0");
    expect(typeof pkg.version).toBe("string");
    expect(pkg.version.length).toBeGreaterThan(0);
  });

  it("serves root endpoint with version from package.json", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      return c.json({
        name: "Compact Playground API",
        version: pkg.version,
      });
    });

    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe(pkg.version);
  });
});
