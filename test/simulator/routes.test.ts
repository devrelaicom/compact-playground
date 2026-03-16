import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { simulateRoutes } from "../../backend/src/routes/simulate.js";
import { resetSessions } from "../../backend/src/simulator/session-manager.js";

const CONTRACT = `pragma language_version >= 0.14;
import CompactStandardLibrary;
export ledger count: Counter;
export circuit inc(n: Uint<64>): [] { count.increment(n); }
export pure circuit get(): Uint<64> { return count; }`;

describe("simulate routes", () => {
  let app: Hono;

  beforeEach(() => {
    resetSessions();
    app = new Hono();
    app.route("/", simulateRoutes);
  });

  it("POST /simulate/deploy creates a session", async () => {
    const res = await app.request("/simulate/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: CONTRACT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.sessionId).toBeDefined();
  });

  it("POST /simulate/:sessionId/call calls a circuit", async () => {
    const deployRes = await app.request("/simulate/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: CONTRACT }),
    });
    const deploy = (await deployRes.json()) as Record<string, unknown>;
    const sessionId = deploy.sessionId as string;

    const callRes = await app.request(`/simulate/${sessionId}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ circuit: "inc", parameters: { n: "5" } }),
    });
    expect(callRes.status).toBe(200);
    const call = (await callRes.json()) as Record<string, unknown>;
    expect(call.success).toBe(true);
  });

  it("GET /simulate/:sessionId/state returns current state", async () => {
    const deployRes = await app.request("/simulate/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: CONTRACT }),
    });
    const deploy = (await deployRes.json()) as Record<string, unknown>;
    const sessionId = deploy.sessionId as string;

    const stateRes = await app.request(`/simulate/${sessionId}/state`);
    expect(stateRes.status).toBe(200);
    const state = (await stateRes.json()) as Record<string, unknown>;
    expect(state.ledgerState).toBeDefined();
  });

  it("DELETE /simulate/:sessionId ends a session", async () => {
    const deployRes = await app.request("/simulate/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: CONTRACT }),
    });
    const deploy = (await deployRes.json()) as Record<string, unknown>;
    const sessionId = deploy.sessionId as string;

    const delRes = await app.request(`/simulate/${sessionId}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);

    const stateRes = await app.request(`/simulate/${sessionId}/state`);
    expect(stateRes.status).toBe(404);
  });

  it("returns 404 for unknown session", async () => {
    const res = await app.request("/simulate/bad-id/state");
    expect(res.status).toBe(404);
  });
});
