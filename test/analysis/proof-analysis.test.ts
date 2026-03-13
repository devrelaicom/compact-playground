import { describe, it, expect } from "vitest";
import { parseSource } from "../../backend/src/analysis/parser.js";
import { buildSemanticModel } from "../../backend/src/analysis/semantic-model.js";
import { buildProofAnalysis } from "../../backend/src/analysis/proof-analysis.js";

const TRANSFER_CONTRACT = `pragma language_version >= 0.14;

import CompactStandardLibrary;

export ledger balance: Counter;

export circuit increment(amount: Uint<64>): [] {
  balance.increment(amount);
}

export pure circuit getBalance(): Uint<64> {
  return balance;
}`;

const emptyAnalysis = {
  proverKnows: [] as Array<{ name: string }>,
  verifierSees: [] as Array<{ name: string }>,
  constraints: [] as Array<{ description: string }>,
  proofFlow: [] as Array<{ actor: string }>,
  narrative: "",
  isPure: false,
};

describe("buildProofAnalysis", () => {
  function analyze(code: string) {
    const source = parseSource(code);
    const model = buildSemanticModel(source);
    return buildProofAnalysis(model);
  }

  it("returns circuit proof analyses for each circuit", () => {
    const result = analyze(TRANSFER_CONTRACT);
    expect(result.circuits).toHaveLength(2);
    expect(result.circuits.map((c) => c.circuit)).toContain("increment");
    expect(result.circuits.map((c) => c.circuit)).toContain("getBalance");
  });

  it("classifies contract state as public or private", () => {
    const result = analyze(TRANSFER_CONTRACT);
    expect(result.contract.publicState).toEqual([{ name: "balance", type: "Counter" }]);
    expect(result.contract.privateState).toEqual([]);
  });

  it("identifies what the prover knows for a mutating circuit", () => {
    const result = analyze(TRANSFER_CONTRACT);
    const increment = result.circuits.find((c) => c.circuit === "increment") ?? emptyAnalysis;
    expect(increment.proverKnows.length).toBeGreaterThan(0);
    const amountItem = increment.proverKnows.find((p) => p.name === "amount");
    expect(amountItem).toBeDefined();
  });

  it("identifies what the verifier sees", () => {
    const result = analyze(TRANSFER_CONTRACT);
    const increment = result.circuits.find((c) => c.circuit === "increment") ?? emptyAnalysis;
    expect(increment.verifierSees.length).toBeGreaterThan(0);
  });

  it("builds constraint descriptions for assert-using circuits", () => {
    const code = `pragma language_version >= 0.14;
import CompactStandardLibrary;
export ledger balance: Counter;
export circuit withdraw(amount: Uint<64>): [] {
  assert(balance >= amount);
  balance.decrement(amount);
}`;
    const result = analyze(code);
    const withdraw = result.circuits.find((c) => c.circuit === "withdraw") ?? emptyAnalysis;
    expect(withdraw.constraints.length).toBeGreaterThan(0);
  });

  it("generates proof flow steps", () => {
    const result = analyze(TRANSFER_CONTRACT);
    const increment = result.circuits.find((c) => c.circuit === "increment") ?? emptyAnalysis;
    expect(increment.proofFlow.length).toBeGreaterThan(0);
    const firstStep = increment.proofFlow[0] ?? { actor: "" };
    expect(firstStep.actor).toBeDefined();
  });

  it("generates a narrative for each circuit", () => {
    const result = analyze(TRANSFER_CONTRACT);
    const increment = result.circuits.find((c) => c.circuit === "increment") ?? emptyAnalysis;
    expect(increment.narrative.length).toBeGreaterThan(0);
  });

  it("marks pure circuits correctly", () => {
    const result = analyze(TRANSFER_CONTRACT);
    const getBalance = result.circuits.find((c) => c.circuit === "getBalance") ?? emptyAnalysis;
    expect(getBalance.isPure).toBe(true);
  });
});
