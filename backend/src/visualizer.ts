import type { ParsedSource, SemanticModel } from "./analysis/types.js";

export interface GraphNode {
  id: string;
  type: "circuit" | "ledger" | "witness";
  label: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "reads" | "writes" | "uses_witness";
}

export interface GraphGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface ContractGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  mermaid: string;
}

export function generateContractGraph(source: ParsedSource, model: SemanticModel): ContractGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const publicNodeIds: string[] = [];
  const privateNodeIds: string[] = [];

  // Circuit nodes
  for (const circuit of source.circuits) {
    const id = `circuit:${circuit.name}`;
    nodes.push({
      id,
      type: "circuit",
      label: circuit.name,
      isPublic: circuit.isExported,
      isPure: circuit.isPure,
      parameters: circuit.parameters,
      returnType: circuit.returnType,
    });
    if (circuit.isExported) {
      publicNodeIds.push(id);
    } else {
      privateNodeIds.push(id);
    }
  }

  // Ledger nodes
  for (const field of source.ledger) {
    const id = `ledger:${field.name}`;
    nodes.push({
      id,
      type: "ledger",
      label: field.name,
      dataType: field.type,
      isPublic: field.isExported,
    });
    if (field.isExported) {
      publicNodeIds.push(id);
    } else {
      privateNodeIds.push(id);
    }
  }

  // Witness nodes (always private)
  for (const witness of source.witnesses) {
    const id = `witness:${witness.name}`;
    nodes.push({
      id,
      type: "witness",
      label: witness.name,
      parameters: witness.parameters,
      returnType: witness.returnType,
    });
    privateNodeIds.push(id);
  }

  // Edges from semantic model
  for (const sc of model.circuits) {
    const circuitId = `circuit:${sc.parsed.name}`;

    for (const fieldName of sc.operations.readsLedger) {
      edges.push({
        source: circuitId,
        target: `ledger:${fieldName}`,
        type: "reads",
      });
    }

    for (const fieldName of sc.operations.writesLedger) {
      edges.push({
        source: circuitId,
        target: `ledger:${fieldName}`,
        type: "writes",
      });
    }

    for (const witnessName of sc.operations.usesWitnesses) {
      edges.push({
        source: circuitId,
        target: `witness:${witnessName}`,
        type: "uses_witness",
      });
    }
  }

  // Privacy groups
  const groups: GraphGroup[] = [];
  if (publicNodeIds.length > 0) {
    groups.push({ id: "public", label: "Public", nodeIds: publicNodeIds });
  }
  if (privateNodeIds.length > 0) {
    groups.push({ id: "private", label: "Private", nodeIds: privateNodeIds });
  }

  const mermaid = generateMermaid(nodes, edges, groups);

  return { nodes, edges, groups, mermaid };
}

function generateMermaid(nodes: GraphNode[], edges: GraphEdge[], groups: GraphGroup[]): string {
  const lines: string[] = ["graph TD"];

  for (const group of groups) {
    lines.push(`  subgraph ${group.id}["${group.label}"]`);
    for (const nodeId of group.nodeIds) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        lines.push(`    ${mermaidNode(node)}`);
      }
    }
    lines.push("  end");
  }

  const groupedIds = new Set(groups.flatMap((g) => g.nodeIds));
  for (const node of nodes) {
    if (!groupedIds.has(node.id)) {
      lines.push(`  ${mermaidNode(node)}`);
    }
  }

  for (const edge of edges) {
    const label = edge.type.replace("_", " ");
    const safeSource = mermaidId(edge.source);
    const safeTarget = mermaidId(edge.target);
    lines.push(`  ${safeSource} -->|${label}| ${safeTarget}`);
  }

  return lines.join("\n");
}

function mermaidId(id: string): string {
  return id.replace(/:/g, "_");
}

function mermaidNode(node: GraphNode): string {
  const id = mermaidId(node.id);
  switch (node.type) {
    case "circuit":
      return `${id}[["${node.label}()"]]`;
    case "ledger":
      return `${id}[("${node.label}")]`;
    case "witness":
      return `${id}{{"${node.label}"}}`;
    default:
      return `${id}["${node.label}"]`;
  }
}
