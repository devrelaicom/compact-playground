import { describe, it, expect } from "vitest";
import { generateContractGraph } from "../backend/src/visualizer.js";
import { parseSource } from "../backend/src/analysis/parser.js";
import { buildSemanticModel } from "../backend/src/analysis/semantic-model.js";

function buildGraph(code: string) {
  const parsed = parseSource(code);
  const model = buildSemanticModel(parsed);
  return generateContractGraph(parsed, model);
}

describe("generateContractGraph", () => {
  it("returns empty graph for empty contract", () => {
    const graph = buildGraph("");
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.groups).toEqual([]);
  });

  it("creates circuit nodes with correct attributes", () => {
    const graph = buildGraph(`
export circuit transfer(amount: Uint<64>): [] {
}
`);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toEqual({
      id: "circuit:transfer",
      type: "circuit",
      label: "transfer",
      isPublic: true,
      isPure: false,
      parameters: [{ name: "amount", type: "Uint<64>" }],
      returnType: "[]",
    });
  });

  it("creates ledger nodes", () => {
    const graph = buildGraph(`
export ledger balance: Uint<64>;
ledger secret: Field;
`);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toEqual({
      id: "ledger:balance",
      type: "ledger",
      label: "balance",
      dataType: "Uint<64>",
      isPublic: true,
    });
    expect(graph.nodes[1]).toEqual({
      id: "ledger:secret",
      type: "ledger",
      label: "secret",
      dataType: "Field",
      isPublic: false,
    });
  });

  it("creates witness nodes", () => {
    const graph = buildGraph(`
witness secret_key: () => Field;
`);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toEqual({
      id: "witness:secret_key",
      type: "witness",
      label: "secret_key",
      parameters: [],
      returnType: "Field",
    });
  });

  it("creates edges for circuit-to-ledger reads and writes", () => {
    const graph = buildGraph(`
export ledger counter: Counter;

export circuit increment(): [] {
  counter.increment(1n);
}
`);
    const readEdge = graph.edges.find((e) => e.type === "reads");
    const writeEdge = graph.edges.find((e) => e.type === "writes");
    expect(readEdge).toEqual({
      source: "circuit:increment",
      target: "ledger:counter",
      type: "reads",
    });
    expect(writeEdge).toEqual({
      source: "circuit:increment",
      target: "ledger:counter",
      type: "writes",
    });
  });

  it("creates edges for circuit-to-witness dependencies", () => {
    const graph = buildGraph(`
witness get_secret: () => Field;

export circuit reveal(): [] {
  const s = get_secret();
  disclose(s);
}
`);
    const witnessEdge = graph.edges.find((e) => e.type === "uses_witness");
    expect(witnessEdge).toEqual({
      source: "circuit:reveal",
      target: "witness:get_secret",
      type: "uses_witness",
    });
  });

  it("creates privacy groups for public and private nodes", () => {
    const graph = buildGraph(`
export ledger balance: Uint<64>;
ledger secret: Field;
export circuit transfer(): [] {}
circuit internal(): [] {}
`);
    expect(graph.groups).toHaveLength(2);

    const publicGroup = graph.groups.find((g) => g.id === "public");
    const privateGroup = graph.groups.find((g) => g.id === "private");

    expect(publicGroup).toBeDefined();
    expect(publicGroup?.nodeIds).toContain("circuit:transfer");
    expect(publicGroup?.nodeIds).toContain("ledger:balance");

    expect(privateGroup).toBeDefined();
    expect(privateGroup?.nodeIds).toContain("circuit:internal");
    expect(privateGroup?.nodeIds).toContain("ledger:secret");
  });

  it("generates valid mermaid diagram", () => {
    const graph = buildGraph(`
export ledger counter: Counter;

export circuit increment(): [] {
  counter.increment(1n);
}
`);
    expect(graph.mermaid).toBeDefined();
    expect(graph.mermaid).toContain("graph TD");
    expect(graph.mermaid).toContain("increment");
    expect(graph.mermaid).toContain("counter");
  });

  it("handles complex contract with multiple relationships", () => {
    const graph = buildGraph(`
export ledger balance: Uint<64>;
ledger nonce: Uint<64>;
witness get_key: () => Field;

export circuit transfer(amount: Uint<64>): [] {
  const key = get_key();
  balance.decrement(amount);
  nonce.increment(1n);
}

export pure circuit verify(x: Field): Boolean {
  return x == 0n;
}
`);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges.length).toBeGreaterThanOrEqual(3);
  });
});
