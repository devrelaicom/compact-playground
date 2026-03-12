// test/analysis/semantic-model.test.ts
import { describe, it, expect } from "vitest";
import { parseSource } from "../../backend/src/analysis/parser.js";
import { buildSemanticModel } from "../../backend/src/analysis/semantic-model.js";

describe("buildSemanticModel", () => {
  describe("circuit operations", () => {
    it("detects disclose usage", () => {
      const parsed = parseSource(`
export ledger value: Field;
export circuit reveal(): [] {
  disclose(value);
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.usesDisclose).toBe(true);
    });

    it("detects commit usage", () => {
      const parsed = parseSource(`
export circuit commitValue(v: Field): Bytes<32> {
  return commit(v);
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.usesCommit).toBe(true);
    });

    it("detects hash usage", () => {
      const parsed = parseSource(`
export circuit hashValue(v: Field): Bytes<32> {
  return hash(v);
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.usesHash).toBe(true);
    });

    it("detects assert usage", () => {
      const parsed = parseSource(`
export circuit check(x: Field): [] {
  assert(x == 1 as Field);
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.usesAssert).toBe(true);
    });

    it("detects ledger reads", () => {
      const parsed = parseSource(`
export ledger counter: Counter;
export circuit getCount(): Field {
  return counter.read();
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.readsLedger).toContain("counter");
    });

    it("detects ledger mutations", () => {
      const parsed = parseSource(`
export ledger counter: Counter;
export circuit inc(): [] {
  counter.increment(1);
}`);
      const model = buildSemanticModel(parsed);
      const ops = model.circuits[0].operations;
      expect(ops.writesLedger).toContain("counter");
      expect(ops.ledgerMutations).toHaveLength(1);
      expect(ops.ledgerMutations[0].operation).toBe("increment");
    });

    it("detects .insert mutation", () => {
      const parsed = parseSource(`
export ledger store: Map<Bytes<32>, Field>;
export circuit add(key: Bytes<32>, val: Field): [] {
  store.insert(key, val);
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.ledgerMutations[0].operation).toBe("insert");
    });

    it("detects .decrement mutation", () => {
      const parsed = parseSource(`
export ledger counter: Counter;
export circuit dec(): [] {
  counter.decrement(1);
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.ledgerMutations[0].operation).toBe("decrement");
    });

    it("detects assignment-style ledger write", () => {
      const parsed = parseSource(`
export ledger value: Field;
export circuit set(v: Field): [] {
  value = v;
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.writesLedger).toContain("value");
      expect(model.circuits[0].operations.ledgerMutations[0].operation).toBe("assign");
    });
  });

  describe("witness usage", () => {
    it("detects witness reference in circuit body", () => {
      const parsed = parseSource(`
witness getSecret: () => Field;
export circuit useSecret(): Field {
  const s = getSecret();
  return s;
}`);
      const model = buildSemanticModel(parsed);
      expect(model.circuits[0].operations.usesWitnesses).toContain("getSecret");
    });

    it("identifies unused witnesses", () => {
      const parsed = parseSource(`
witness unused: () => Field;
export circuit noWitness(): [] {}`);
      const model = buildSemanticModel(parsed);
      expect(model.unusedWitnesses).toContain("unused");
    });

    it("does not flag used witnesses as unused", () => {
      const parsed = parseSource(`
witness used: () => Field;
export circuit useIt(): Field {
  return used();
}`);
      const model = buildSemanticModel(parsed);
      expect(model.unusedWitnesses).not.toContain("used");
    });
  });

  describe("stdlib import", () => {
    it("detects CompactStandardLibrary import", () => {
      const parsed = parseSource(`import CompactStandardLibrary;`);
      const model = buildSemanticModel(parsed);
      expect(model.hasStdLibImport).toBe(true);
    });

    it("detects missing stdlib import", () => {
      const parsed = parseSource(`export circuit foo(): [] {}`);
      const model = buildSemanticModel(parsed);
      expect(model.hasStdLibImport).toBe(false);
    });
  });
});
