import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { resetSessions } from "../../backend/src/simulator/session-manager.js";

// Mock compilation
vi.mock("../../backend/src/compiler.js", () => ({
  compile: vi.fn(),
}));

// Mock OZ factory
vi.mock("../../backend/src/simulator/oz-factory.js", () => ({
  createContractSimulator: vi.fn(),
  findContractEntry: vi.fn(),
}));

import { deployContract, callCircuit } from "../../backend/src/simulator/engine.js";
import { compile } from "../../backend/src/compiler.js";
import { createContractSimulator } from "../../backend/src/simulator/oz-factory.js";
import type { SimulatorHandle } from "../../backend/src/simulator/types.js";

const SIMPLE_CONTRACT = `pragma language_version >= 0.14;

import CompactStandardLibrary;

export ledger balance: Counter;

export circuit increment(amount: Uint<64>): [] {
  balance.increment(amount);
}

export pure circuit getBalance(): Uint<64> {
  return balance;
}`;

function mockSuccessfulCompile() {
  vi.mocked(compile).mockResolvedValue({
    result: {
      success: true,
      compiledAt: new Date().toISOString(),
      bindings: { "contract/index.cjs": "exports.Contract = class {};" },
    },
  });
}

function createMockHandle(
  initialState: Record<string, unknown> = { balance: 0n },
): SimulatorHandle {
  const state = { ...initialState };
  return {
    callPure: vi.fn(() => state.balance),
    callImpure: vi.fn(() => {
      if (typeof state.balance === "bigint") {
        state.balance = state.balance + 1n;
      }
    }),
    getPublicState: vi.fn(() => ({ ...state })),
    getPrivateState: vi.fn(() => null),
    getCircuits: vi.fn(() => ({
      pure: ["getBalance"],
      impure: ["increment"],
    })),
    setCaller: vi.fn(),
    resetCaller: vi.fn(),
    cleanup: vi.fn(async () => {}),
  };
}

describe("simulation engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetSessions();
  });

  describe("deployContract", () => {
    it("deploys a valid contract and returns session info", async () => {
      mockSuccessfulCompile();
      vi.mocked(createContractSimulator).mockResolvedValue(createMockHandle());

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

    it("returns error when compilation fails", async () => {
      vi.mocked(compile).mockResolvedValue({
        result: {
          success: false,
          compiledAt: new Date().toISOString(),
          errors: [{ message: "Syntax error on line 1", severity: "error" }],
        },
      });

      const result = await deployContract({ code: "bad code" });
      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toMatch(/syntax/i);
    });

    it("returns error when compilation produces no bindings", async () => {
      vi.mocked(compile).mockResolvedValue({
        result: {
          success: true,
          compiledAt: new Date().toISOString(),
        },
      });

      const result = await deployContract({ code: SIMPLE_CONTRACT });
      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toMatch(/bindings/i);
    });

    it("returns error when simulator creation fails", async () => {
      mockSuccessfulCompile();
      vi.mocked(createContractSimulator).mockRejectedValue(new Error("Contract class not found"));

      const result = await deployContract({ code: SIMPLE_CONTRACT });
      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toMatch(/simulator/i);
    });
  });

  describe("callCircuit", () => {
    async function deployTestContract() {
      mockSuccessfulCompile();
      const mockHandle = createMockHandle();
      vi.mocked(createContractSimulator).mockResolvedValue(mockHandle);

      const deploy = await deployContract({ code: SIMPLE_CONTRACT });
      return { deploy, mockHandle };
    }

    it("calls a circuit and returns state changes on the called circuit", async () => {
      const { deploy, mockHandle } = await deployTestContract();
      expect(deploy.success).toBe(true);

      // After calling increment, the handle reports updated state.
      // First getPublicState call in callCircuit captures "before" state,
      // second call captures "after" state.
      (mockHandle.getPublicState as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ balance: 0n })
        .mockReturnValueOnce({ balance: 100n });

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
      const { deploy } = await deployTestContract();
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
