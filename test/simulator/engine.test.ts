import { describe, it, expect, afterEach } from "vitest";
import { deployContract, callCircuit } from "../../backend/src/simulator/engine.js";
import { resetSessions } from "../../backend/src/simulator/session-manager.js";

const SIMPLE_CONTRACT = `pragma language_version >= 0.14;

import CompactStandardLibrary;

export ledger balance: Counter;

export circuit increment(amount: Uint<64>): [] {
  balance.increment(amount);
}

export pure circuit getBalance(): Uint<64> {
  return balance;
}`;

describe("simulation engine", () => {
  afterEach(() => {
    resetSessions();
  });

  describe("deployContract", () => {
    it("deploys a valid contract and returns session info", async () => {
      const result = await deployContract({ code: SIMPLE_CONTRACT });
      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.circuits).toBeDefined();
      expect(result.circuits?.length).toBeGreaterThan(0);
      expect(result.ledgerState).toBeDefined();
      expect(result.callHistory).toEqual([]);
      expect(result.expiresAt).toBeDefined();
    });

    it("returns error for empty code", async () => {
      const result = await deployContract({ code: "" });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe("callCircuit", () => {
    it("calls a circuit and returns state changes on the called circuit", async () => {
      const deploy = await deployContract({ code: SIMPLE_CONTRACT });
      expect(deploy.success).toBe(true);
      expect(deploy.sessionId).toBeDefined();

      const result = await callCircuit(deploy.sessionId as string, {
        circuit: "increment",
        parameters: { amount: "100" },
      });

      expect(result.success).toBe(true);
      expect(result.circuits).toBeDefined();
      const calledCircuit = result.circuits?.find((c) => c.name === "increment");
      expect(calledCircuit?.stateChanges).toBeDefined();
      expect(calledCircuit?.stateChanges?.length).toBeGreaterThan(0);
    });

    it("returns error for unknown circuit", async () => {
      const deploy = await deployContract({ code: SIMPLE_CONTRACT });
      const result = await callCircuit(deploy.sessionId as string, {
        circuit: "nonexistent",
      });
      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toMatch(/not found/i);
      expect(result.errors?.[0].errorCode).toBe("CIRCUIT_NOT_FOUND");
    });

    it("returns error for unknown session", async () => {
      const result = await callCircuit("bad-id", { circuit: "foo" });
      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toMatch(/session/i);
      expect(result.errors?.[0].errorCode).toBe("SESSION_NOT_FOUND");
      expect(result.sessionId).toBe("bad-id");
    });
  });
});
