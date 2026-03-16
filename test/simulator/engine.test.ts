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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(result.circuits!.length).toBeGreaterThan(0);
      expect(result.ledgerState).toBeDefined();
    });

    it("returns error for empty code", async () => {
      const result = await deployContract({ code: "" });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("callCircuit", () => {
    it("calls a circuit and returns state changes", async () => {
      const deploy = await deployContract({ code: SIMPLE_CONTRACT });
      expect(deploy.success).toBe(true);

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const result = await callCircuit(deploy.sessionId!, {
        circuit: "increment",
        parameters: { amount: "100" },
      });

      expect(result.success).toBe(true);
      expect(result.stateChanges).toBeDefined();
    });

    it("returns error for unknown circuit", async () => {
      const deploy = await deployContract({ code: SIMPLE_CONTRACT });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const result = await callCircuit(deploy.sessionId!, {
        circuit: "nonexistent",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it("returns error for unknown session", async () => {
      const result = await callCircuit("bad-id", { circuit: "foo" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session/i);
    });
  });
});
