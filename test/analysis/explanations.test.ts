// test/analysis/explanations.test.ts
import { describe, it, expect } from "vitest";
import { parseSource } from "../../backend/src/analysis/parser.js";
import { buildSemanticModel } from "../../backend/src/analysis/semantic-model.js";
import { buildExplanations } from "../../backend/src/analysis/explanations.js";

function explanationsFor(code: string) {
  const parsed = parseSource(code);
  const model = buildSemanticModel(parsed);
  return buildExplanations(model);
}

describe("buildExplanations", () => {
  it("produces explanation for exported circuit", () => {
    const explanations = explanationsFor(`
export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`);
    expect(explanations).toHaveLength(1);
    const e = explanations[0] ?? {
      circuitName: "",
      isPublic: false,
      explanation: "",
      parameters: [],
      returnType: "",
    };
    expect(e.circuitName).toBe("add");
    expect(e.isPublic).toBe(true);
    expect(e.explanation).toContain("public");
    expect(e.parameters).toHaveLength(2);
    expect(e.returnType).toBe("Uint<64>");
  });

  it("includes disclose operation and privacy implications", () => {
    const explanations = explanationsFor(`
export ledger secret: Field;
export circuit reveal(): Field {
  return disclose(secret);
}`);
    const e = explanations[0] ?? { operations: [], zkImplications: [], privacyConsiderations: [] };
    expect(e.operations).toEqual(expect.arrayContaining([expect.stringContaining("disclose")]));
    expect(e.zkImplications).toEqual(
      expect.arrayContaining([expect.stringContaining("visible on-chain")]),
    );
    expect(e.privacyConsiderations).toEqual(
      expect.arrayContaining([expect.stringContaining("disclose")]),
    );
  });

  it("includes commit operation", () => {
    const explanations = explanationsFor(`
export circuit commitVal(v: Field): Bytes<32> {
  return commit(v);
}`);
    expect(explanations[0]?.operations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining("commit")]),
    );
  });

  it("includes hash operation", () => {
    const explanations = explanationsFor(`
export circuit hashVal(v: Field): Bytes<32> {
  return hash(v);
}`);
    expect(explanations[0]?.operations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining("hash")]),
    );
  });

  it("includes assert operation", () => {
    const explanations = explanationsFor(`
export circuit check(x: Field): [] {
  assert(x == 1 as Field);
}`);
    const e = explanations[0] ?? { operations: [], zkImplications: [] };
    expect(e.operations).toEqual(expect.arrayContaining([expect.stringContaining("assert")]));
    expect(e.zkImplications).toEqual(
      expect.arrayContaining([expect.stringContaining("constraint")]),
    );
  });

  it("includes ledger mutation operations", () => {
    const explanations = explanationsFor(`
export ledger counter: Counter;
export circuit inc(): [] {
  counter.increment(1);
}`);
    expect(explanations[0]?.operations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining("increment")]),
    );
  });

  it("marks internal (non-exported) circuit", () => {
    const explanations = explanationsFor(`
circuit helper(): Field { return 0 as Field; }`);
    expect(explanations[0]?.isPublic).toBe(false);
    expect(explanations[0]?.explanation).toContain("internal");
  });

  it("notes witness access in privacy considerations", () => {
    const explanations = explanationsFor(`
witness getSecret: () => Field;
export circuit useSecret(): Field {
  return getSecret();
}`);
    expect(explanations[0]?.privacyConsiderations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining("witness")]),
    );
  });
});
