// test/analysis/rules.test.ts
import { describe, it, expect } from "vitest";
import { parseSource } from "../../backend/src/analysis/parser.js";
import { buildSemanticModel } from "../../backend/src/analysis/semantic-model.js";
import { runRules } from "../../backend/src/analysis/rules.js";

function findingsFor(code: string) {
  const parsed = parseSource(code);
  const model = buildSemanticModel(parsed);
  return runRules(model);
}

function findingCodes(code: string) {
  return findingsFor(code).map((f) => f.code);
}

describe("runRules", () => {
  // ── Spec-mandated rules ──

  describe("missing-stdlib-import", () => {
    it("fires when CompactStandardLibrary is not imported", () => {
      const codes = findingCodes(`export circuit foo(): [] {}`);
      expect(codes).toContain("missing-stdlib-import");
    });

    it("does not fire when stdlib is imported", () => {
      const codes = findingCodes(`import CompactStandardLibrary;\nexport circuit foo(): [] {}`);
      expect(codes).not.toContain("missing-stdlib-import");
    });
  });

  describe("unused-witness", () => {
    it("fires when a witness is never referenced", () => {
      const codes = findingCodes(`
witness unused: () => Field;
export circuit foo(): [] {}`);
      expect(codes).toContain("unused-witness");
    });

    it("does not fire when witness is used", () => {
      const codes = findingCodes(`
witness used: () => Field;
export circuit foo(): Field { return used(); }`);
      expect(codes).not.toContain("unused-witness");
    });
  });

  describe("private-field-in-public-circuit", () => {
    it("fires when non-exported ledger field is read in exported circuit without disclose", () => {
      const codes = findingCodes(`
ledger secret: Field;
export circuit leak(): Field { return secret; }`);
      expect(codes).toContain("private-field-in-public-circuit");
    });

    it("does not fire when disclose is used", () => {
      const codes = findingCodes(`
ledger secret: Field;
export circuit reveal(): Field { return disclose(secret); }`);
      expect(codes).not.toContain("private-field-in-public-circuit");
    });

    it("does not fire for exported ledger fields", () => {
      const codes = findingCodes(`
export ledger counter: Counter;
export circuit getCount(): Field { return counter.read(); }`);
      expect(codes).not.toContain("private-field-in-public-circuit");
    });
  });

  describe("public-circuit-unguarded-mutation", () => {
    it("fires when exported circuit mutates ledger without assert", () => {
      const codes = findingCodes(`
export ledger counter: Counter;
export circuit inc(): [] { counter.increment(1); }`);
      expect(codes).toContain("public-circuit-unguarded-mutation");
    });

    it("does not fire when assert is present", () => {
      const codes = findingCodes(`
export ledger counter: Counter;
export circuit inc(caller: Bytes<32>): [] {
  assert(caller == ownPublicKey());
  counter.increment(1);
}`);
      expect(codes).not.toContain("public-circuit-unguarded-mutation");
    });
  });

  // ── MCP-ported checks ──

  describe("deprecated-ledger-block", () => {
    it("fires for ledger { } syntax", () => {
      const codes = findingCodes(`ledger { counter: Counter; }`);
      expect(codes).toContain("deprecated-ledger-block");
    });
  });

  describe("invalid-void-type", () => {
    it("fires for Void return type", () => {
      const codes = findingCodes(`circuit foo(): Void {}`);
      expect(codes).toContain("invalid-void-type");
    });
  });

  describe("invalid-pragma-format", () => {
    it("fires for pragma with patch version", () => {
      const codes = findingCodes(`pragma language_version >= 0.16.0;`);
      expect(codes).toContain("invalid-pragma-format");
    });
  });

  describe("unexported-enum", () => {
    it("fires for enum without export", () => {
      const codes = findingCodes(`enum Color { Red, Green }`);
      expect(codes).toContain("unexported-enum");
    });

    it("does not fire for exported enum", () => {
      const codes = findingCodes(`export enum Color { Red, Green }`);
      expect(codes).not.toContain("unexported-enum");
    });
  });

  describe("deprecated-cell-wrapper", () => {
    it("fires for Cell<T> usage", () => {
      const codes = findingCodes(`export ledger value: Cell<Field>;`);
      expect(codes).toContain("deprecated-cell-wrapper");
    });
  });

  describe("module-level-const", () => {
    it("fires for top-level const", () => {
      const codes = findingCodes(`const MAX: Uint<64> = 100;`);
      expect(codes).toContain("module-level-const");
    });
  });

  describe("stdlib-name-collision", () => {
    it("fires when circuit name conflicts with stdlib export", () => {
      const codes = findingCodes(`
import CompactStandardLibrary;
export circuit Counter(): [] {}`);
      expect(codes).toContain("stdlib-name-collision");
    });
  });

  describe("unsupported-division", () => {
    it("fires for division operator usage", () => {
      const codes = findingCodes(`export circuit div(a: Field, b: Field): Field { return a / b; }`);
      expect(codes).toContain("unsupported-division");
    });

    it("does not fire for comments with slashes", () => {
      const codes = findingCodes(`// this is a/comment
export circuit foo(): [] {}`);
      expect(codes).not.toContain("unsupported-division");
    });
  });

  describe("invalid-counter-access", () => {
    it("fires for .value() on Counter field", () => {
      const codes = findingCodes(`
export ledger counter: Counter;
export circuit get(): Field { return counter.value(); }`);
      expect(codes).toContain("invalid-counter-access");
    });
  });

  describe("invalid-if-expression", () => {
    it("fires for if used as expression in assignment", () => {
      const codes = findingCodes(`
export circuit foo(): Field {
  const x = if (true) { 1 };
}`);
      expect(codes).toContain("invalid-if-expression");
    });
  });

  describe("no findings on clean code", () => {
    it("produces no findings for well-formed contract", () => {
      const findings = findingsFor(`
pragma language_version >= 0.16 && <= 0.18;
import CompactStandardLibrary;

export ledger counter: Counter;

export circuit increment(caller: Bytes<32>): [] {
  assert(caller == ownPublicKey());
  counter.increment(1);
}`);
      expect(findings).toHaveLength(0);
    });
  });
});
