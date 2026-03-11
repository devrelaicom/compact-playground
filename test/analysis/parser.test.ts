// test/analysis/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseSource } from "../../backend/src/analysis/parser.js";

describe("parseSource", () => {
  describe("pragma", () => {
    it("extracts bounded pragma", () => {
      const result = parseSource(`pragma language_version >= 0.16 && <= 0.18;`);
      expect(result.pragma).toBe(">= 0.16 && <= 0.18");
      expect(result.pragmaVersion).toBe("0.16");
    });

    it("extracts simple pragma", () => {
      const result = parseSource(`pragma language_version >= 0.14;`);
      expect(result.pragma).toBe(">= 0.14");
      expect(result.pragmaVersion).toBe("0.14");
    });

    it("returns null for missing pragma", () => {
      const result = parseSource(`import CompactStandardLibrary;`);
      expect(result.pragma).toBeNull();
      expect(result.pragmaVersion).toBeNull();
    });
  });

  describe("imports", () => {
    it("extracts imports", () => {
      const result = parseSource(`import CompactStandardLibrary;\nimport MyLib;`);
      expect(result.imports).toEqual(["CompactStandardLibrary", "MyLib"]);
    });

    it("returns empty array for no imports", () => {
      const result = parseSource(`export circuit foo(): [] {}`);
      expect(result.imports).toEqual([]);
    });
  });

  describe("circuits", () => {
    it("extracts exported circuit with parameters", () => {
      const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
      const result = parseSource(code);
      expect(result.circuits).toHaveLength(1);
      const c = result.circuits[0];
      expect(c.name).toBe("add");
      expect(c.isExported).toBe(true);
      expect(c.isPure).toBe(false);
      expect(c.parameters).toEqual([
        { name: "a", type: "Uint<64>" },
        { name: "b", type: "Uint<64>" },
      ]);
      expect(c.returnType).toBe("Uint<64>");
      expect(c.location.line).toBe(1);
      expect(c.body).toContain("return");
    });

    it("extracts pure circuit", () => {
      const result = parseSource(`pure circuit helper(x: Field): Field { return x; }`);
      expect(result.circuits[0].isPure).toBe(true);
      expect(result.circuits[0].isExported).toBe(false);
    });

    it("extracts export pure circuit", () => {
      const result = parseSource(`export pure circuit helper(x: Field): Field { return x; }`);
      expect(result.circuits[0].isPure).toBe(true);
      expect(result.circuits[0].isExported).toBe(true);
    });

    it("extracts no-param circuit", () => {
      const result = parseSource(`export circuit init(): [] {}`);
      expect(result.circuits[0].parameters).toEqual([]);
      expect(result.circuits[0].returnType).toBe("[]");
    });

    it("extracts multiple circuits with correct line numbers", () => {
      const code = `export circuit a(): [] {}

export circuit b(): [] {}`;
      const result = parseSource(code);
      expect(result.circuits).toHaveLength(2);
      expect(result.circuits[0].location.line).toBe(1);
      expect(result.circuits[1].location.line).toBe(3);
    });

    it("handles nested generic parameters", () => {
      const code = `export circuit foo(m: Map<Bytes<32>, Uint<64>>): [] {}`;
      const result = parseSource(code);
      expect(result.circuits[0].parameters).toEqual([
        { name: "m", type: "Map<Bytes<32>, Uint<64>>" },
      ]);
    });
  });

  describe("witnesses", () => {
    it("extracts witness with function type", () => {
      const code = `witness myWitness: (Field) => Boolean;`;
      const result = parseSource(code);
      expect(result.witnesses).toHaveLength(1);
      expect(result.witnesses[0].name).toBe("myWitness");
      expect(result.witnesses[0].returnType).toBe("Boolean");
    });

    it("extracts exported witness", () => {
      const code = `export witness getSecret: () => Field;`;
      const result = parseSource(code);
      expect(result.witnesses[0].isExported).toBe(true);
    });
  });

  describe("ledger", () => {
    it("extracts exported ledger fields", () => {
      const code = `export ledger counter: Counter;\nexport ledger balance: Uint<64>;`;
      const result = parseSource(code);
      expect(result.ledger).toHaveLength(2);
      expect(result.ledger[0].name).toBe("counter");
      expect(result.ledger[0].type).toBe("Counter");
      expect(result.ledger[0].isExported).toBe(true);
      expect(result.ledger[0].isSealed).toBe(false);
    });

    it("detects sealed ledger fields", () => {
      const code = `sealed ledger owner: Bytes<32>;`;
      const result = parseSource(code);
      expect(result.ledger[0].isSealed).toBe(true);
      expect(result.ledger[0].isExported).toBe(false);
    });
  });

  describe("types", () => {
    it("extracts type aliases", () => {
      const code = `type Amount = Uint<64>;`;
      const result = parseSource(code);
      expect(result.types).toHaveLength(1);
      expect(result.types[0].name).toBe("Amount");
      expect(result.types[0].definition).toBe("Uint<64>");
    });
  });

  describe("structs", () => {
    it("extracts struct with fields", () => {
      const code = `export struct Point { x: Field, y: Field }`;
      const result = parseSource(code);
      expect(result.structs).toHaveLength(1);
      expect(result.structs[0].name).toBe("Point");
      expect(result.structs[0].isExported).toBe(true);
      expect(result.structs[0].fields).toHaveLength(2);
    });
  });

  describe("enums", () => {
    it("extracts enum with variants", () => {
      const code = `export enum Color { Red, Green, Blue }`;
      const result = parseSource(code);
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe("Color");
      expect(result.enums[0].variants).toEqual(["Red", "Green", "Blue"]);
    });
  });

  describe("constructor", () => {
    it("extracts constructor with parameters", () => {
      const code = `constructor(owner: Bytes<32>) {
  initialOwner = disclose(owner);
}`;
      const result = parseSource(code);
      const ctor = result.constructor;
      expect(ctor).not.toBeNull();
      if (ctor === null) return;
      expect(ctor.parameters).toEqual([{ name: "owner", type: "Bytes<32>" }]);
      expect(ctor.body).toContain("disclose");
    });

    it("extracts constructor without parameters", () => {
      const code = `constructor {
  counter = Counter.default();
}`;
      const result = parseSource(code);
      const ctor = result.constructor;
      expect(ctor).not.toBeNull();
      if (ctor === null) return;
      expect(ctor.parameters).toEqual([]);
    });
  });

  describe("exports", () => {
    it("collects all exported names", () => {
      const code = `export circuit foo(): [] {}
export ledger bar: Counter;
circuit internal(): [] {}`;
      const result = parseSource(code);
      expect(result.exports).toContain("foo");
      expect(result.exports).toContain("bar");
      expect(result.exports).not.toContain("internal");
    });
  });

  describe("empty / edge cases", () => {
    it("handles empty code", () => {
      const result = parseSource("");
      expect(result.circuits).toEqual([]);
      expect(result.ledger).toEqual([]);
      expect(result.imports).toEqual([]);
      expect(result.pragma).toBeNull();
    });

    it("handles code with only comments", () => {
      const result = parseSource(`// just a comment\n/* block */`);
      expect(result.circuits).toEqual([]);
    });
  });
});
