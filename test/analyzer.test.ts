import { describe, it, expect } from "vitest";
import { analyzeSource } from "../backend/src/analyzer.js";

describe("analyzer", () => {
  describe("analyzeSource (fast lint)", () => {
    it("extracts exported circuits", () => {
      const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}

export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a - b) as Uint<64>;
}`;

      const result = analyzeSource(code);

      expect(result.circuits).toHaveLength(2);
      expect(result.circuits[0].name).toBe("add");
      expect(result.circuits[0].exported).toBe(true);
      expect(result.circuits[0].params).toEqual([
        { name: "a", type: "Uint<64>" },
        { name: "b", type: "Uint<64>" },
      ]);
      expect(result.circuits[0].returnType).toBe("Uint<64>");
      expect(result.circuits[1].name).toBe("subtract");
    });

    it("extracts ledger declarations", () => {
      const code = `export ledger counter: Counter;
export ledger balance: Uint<64>;`;

      const result = analyzeSource(code);

      expect(result.ledger).toHaveLength(2);
      expect(result.ledger[0]).toEqual({ name: "counter", type: "Counter", exported: true });
      expect(result.ledger[1]).toEqual({ name: "balance", type: "Uint<64>", exported: true });
    });

    it("detects imports", () => {
      const code = `import CompactStandardLibrary;`;

      const result = analyzeSource(code);

      expect(result.imports).toContain("CompactStandardLibrary");
    });

    it("detects pragma version", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;`;

      const result = analyzeSource(code);

      expect(result.pragma).toBe(">= 0.16 && <= 0.18");
    });

    it("detects pure circuits", () => {
      const code = `pure circuit helper(x: Field): Field {
  return x;
}`;

      const result = analyzeSource(code);

      expect(result.circuits).toHaveLength(1);
      expect(result.circuits[0].pure).toBe(true);
    });

    it("handles empty code", () => {
      const result = analyzeSource("");

      expect(result.circuits).toEqual([]);
      expect(result.ledger).toEqual([]);
      expect(result.imports).toEqual([]);
    });
  });
});
