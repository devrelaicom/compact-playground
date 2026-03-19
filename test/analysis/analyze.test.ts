// test/analysis/analyze.test.ts
import { describe, it, expect } from "vitest";
import { analyzeContract } from "../../backend/src/analysis/index.js";

describe("analyzeContract", () => {
  describe("fast mode", () => {
    it("returns canonical response for a complete contract", async () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;

import CompactStandardLibrary;

export ledger counter: Counter;
export ledger balance: Uint<64>;

witness getSecret: () => Field;

export circuit increment(caller: Bytes<32>): [] {
  assert(caller == ownPublicKey());
  counter.increment(1);
}

export circuit getBalance(): Uint<64> {
  return balance;
}`;

      const { result } = await analyzeContract(code, { mode: "fast" });

      // Top-level shape
      expect(result.success).toBe(true);
      expect(result.mode).toBe("fast");
      expect(result.compilations).toBeUndefined();

      // Summary
      expect(result.summary.hasLedger).toBe(true);
      expect(result.summary.hasCircuits).toBe(true);
      expect(result.summary.hasWitnesses).toBe(true);
      expect(result.summary.publicCircuits).toBe(2);
      expect(result.summary.privateCircuits).toBe(0);
      expect(result.summary.publicState).toBe(2);
      expect(result.summary.privateState).toBe(0);

      // Structure
      expect(result.structure.imports).toContain("CompactStandardLibrary");
      expect(result.structure.exports).toContain("increment");
      expect(result.structure.ledger).toHaveLength(2);
      expect(result.structure.circuits).toHaveLength(2);
      expect(result.structure.witnesses).toHaveLength(1);

      // Circuits
      expect(result.circuits).toHaveLength(2);
      expect(result.circuits[0]?.name).toBe("increment");
      expect(result.circuits[0]?.explanation.circuitName).toBe("increment");

      // Findings
      expect(result.findings).toBeInstanceOf(Array);

      // Recommendations
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it("returns diagnostics for empty code", async () => {
      const { result } = await analyzeContract("", { mode: "fast" });
      expect(result.success).toBe(true);
      expect(result.summary.hasCircuits).toBe(false);
    });

    it("filters by circuit name when circuit option is set", async () => {
      const code = `
import CompactStandardLibrary;
export circuit a(): [] {}
export circuit b(): [] {}`;

      const { result } = await analyzeContract(code, { mode: "fast", circuit: "a" });
      expect(result.circuits).toHaveLength(1);
      expect(result.circuits[0]?.name).toBe("a");
    });

    it("respects include[] to filter response sections", async () => {
      const code = `
import CompactStandardLibrary;
export ledger counter: Counter;
witness unused: () => Field;
export circuit inc(): [] { counter.increment(1); }`;

      const { result: full } = await analyzeContract(code, { mode: "fast" });
      expect(full.findings.length).toBeGreaterThan(0);
      expect(full.circuits.length).toBeGreaterThan(0);

      const { result: filtered } = await analyzeContract(code, {
        mode: "fast",
        include: ["diagnostics"],
      });
      expect(filtered.findings).toEqual([]);
      expect(filtered.circuits).toEqual([]);
      expect(filtered.recommendations).toEqual([]);
      // diagnostics should still be present (requested)
      expect(filtered.diagnostics).toBeDefined();
      // summary and structure are always present
      expect(filtered.summary).toBeDefined();
      expect(filtered.structure).toBeDefined();
    });

    it("populates circuit facts", async () => {
      const code = `
import CompactStandardLibrary;
export ledger counter: Counter;
export circuit inc(): [] {
  disclose(counter);
  counter.increment(1);
}`;

      const { result } = await analyzeContract(code, { mode: "fast" });
      expect(result.circuits).toHaveLength(1);
      const circuit = result.circuits[0];
      expect(circuit).toBeDefined();
      expect(circuit.facts.revealsPrivateData).toBe(true);
      expect(circuit.facts.mutatesLedger).toBe(true);
      expect(circuit.facts.ledgerMutations).toContain("counter");
    });
  });
});
