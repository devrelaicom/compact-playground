import { describe, it, expect } from "vitest";
import { diffContracts } from "../backend/src/differ.js";

describe("differ", () => {
  it("detects added circuits", async () => {
    const before = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;

    const after = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}

export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a - b) as Uint<64>;
}`;

    const { result: diff } = await diffContracts(before, after);

    expect(diff.circuits.added).toHaveLength(1);
    expect(diff.circuits.added[0].name).toBe("subtract");
    expect(diff.circuits.removed).toHaveLength(0);
  });

  it("detects removed circuits", async () => {
    const before = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}

export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a - b) as Uint<64>;
}`;

    const after = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;

    const { result: diff } = await diffContracts(before, after);

    expect(diff.circuits.removed).toHaveLength(1);
    expect(diff.circuits.removed[0].name).toBe("subtract");
  });

  it("detects modified circuit signatures", async () => {
    const before = `export circuit transfer(amount: Uint<32>): [] {
  return;
}`;

    const after = `export circuit transfer(amount: Uint<64>): [] {
  return;
}`;

    const { result: diff } = await diffContracts(before, after);

    expect(diff.circuits.modified).toHaveLength(1);
    expect(diff.circuits.modified[0].name).toBe("transfer");
    expect(diff.circuits.modified[0].changes).toContain("params");
  });

  it("detects added ledger fields", async () => {
    const before = `export ledger counter: Counter;`;
    const after = `export ledger counter: Counter;
export ledger balance: Uint<64>;`;

    const { result: diff } = await diffContracts(before, after);

    expect(diff.ledger.added).toHaveLength(1);
    expect(diff.ledger.added[0].name).toBe("balance");
  });

  it("detects ledger type changes", async () => {
    const before = `export ledger balance: Uint<32>;`;
    const after = `export ledger balance: Uint<64>;`;

    const { result: diff } = await diffContracts(before, after);

    expect(diff.ledger.modified).toHaveLength(1);
    expect(diff.ledger.modified[0].name).toBe("balance");
    expect(diff.ledger.modified[0].before).toBe("Uint<32>");
    expect(diff.ledger.modified[0].after).toBe("Uint<64>");
  });

  it("reports no changes for identical contracts", async () => {
    const code = `export circuit add(a: Uint<64>): Uint<64> { return a; }`;

    const { result: diff } = await diffContracts(code, code);

    expect(diff.circuits.added).toHaveLength(0);
    expect(diff.circuits.removed).toHaveLength(0);
    expect(diff.circuits.modified).toHaveLength(0);
    expect(diff.ledger.added).toHaveLength(0);
    expect(diff.ledger.removed).toHaveLength(0);
    expect(diff.ledger.modified).toHaveLength(0);
    expect(diff.hasChanges).toBe(false);
  });
});
