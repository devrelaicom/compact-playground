import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { proveRoutes } from "../../backend/src/routes/prove.js";

const SIMPLE_CONTRACT = `pragma language_version >= 0.14;
import CompactStandardLibrary;
export ledger balance: Counter;
export circuit increment(amount: Uint<64>): [] {
  balance.increment(amount);
}
export pure circuit getBalance(): Uint<64> {
  return balance;
}`;

describe("POST /prove", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", proveRoutes);
  });

  it("returns proof analysis for valid contract", async () => {
    const res = await app.request("/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: SIMPLE_CONTRACT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.circuits).toBeDefined();
    expect((body.circuits as unknown[]).length).toBeGreaterThan(0);
    expect(body.contract).toBeDefined();
  });

  it("filters by circuit name when provided", async () => {
    const res = await app.request("/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: SIMPLE_CONTRACT, circuit: "increment" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const circuits = body.circuits as Record<string, unknown>[];
    expect(circuits).toHaveLength(1);
    expect(circuits[0].circuit).toBe("increment");
  });

  it("returns 400 for missing code", async () => {
    const res = await app.request("/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("includes proverKnows and verifierSees for each circuit", async () => {
    const res = await app.request("/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: SIMPLE_CONTRACT, circuit: "increment" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    const circuits = body.circuits as Record<string, unknown>[];
    const circuit = circuits[0];
    expect(circuit.proverKnows).toBeDefined();
    expect(circuit.verifierSees).toBeDefined();
    expect(circuit.proofFlow).toBeDefined();
    expect(circuit.narrative).toBeDefined();
    expect(circuit.privacyBoundary).toBeDefined();
  });

  it("handles unparseable code gracefully", async () => {
    const res = await app.request("/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "}{invalid code{}" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBeDefined();
  });
});
