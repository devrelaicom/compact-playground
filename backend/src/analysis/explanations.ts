// backend/src/analysis/explanations.ts
import type { SemanticModel, CircuitExplanation } from "./types.js";

export function buildExplanations(model: SemanticModel): CircuitExplanation[] {
  return model.circuits.map((sc) => {
    const { parsed, operations } = sc;
    const ops: string[] = [];
    const zkImplications: string[] = [];
    const privacyConsiderations: string[] = [];

    // Operations
    if (operations.usesDisclose) {
      ops.push("Reveals private data selectively (disclose)");
      zkImplications.push(
        "Data revealed via disclose() will be visible on-chain while proving possession of private data",
      );
    }
    if (operations.usesCommit) {
      ops.push("Creates cryptographic commitments (commit)");
      zkImplications.push("Commitments allow hiding data while proving properties about it");
    }
    if (operations.usesHash) {
      ops.push("Computes cryptographic hashes (hash)");
      zkImplications.push(
        "Hashes are computed in-circuit and can be verified without revealing preimages",
      );
    }
    if (operations.usesAssert) {
      ops.push("Validates constraints (assert)");
      zkImplications.push(
        "Assertions create ZK constraints — the proof will fail if any assertion fails",
      );
    }
    for (const mutation of operations.ledgerMutations) {
      const opName = mutation.operation;
      if (opName === "insert") ops.push(`Ledger insert on ${mutation.field}`);
      else if (opName === "increment") ops.push(`Ledger increment on ${mutation.field}`);
      else if (opName === "decrement") ops.push(`Ledger decrement on ${mutation.field}`);
      else ops.push(`Ledger assign on ${mutation.field}`);
    }

    // Privacy considerations
    if (operations.usesDisclose) {
      privacyConsiderations.push("Uses disclose() — some private data will be revealed on-chain");
    }
    if (parsed.isExported) {
      privacyConsiderations.push("Public circuit — anyone can call this and generate proofs");
    }
    if (operations.usesWitnesses.length > 0) {
      privacyConsiderations.push(
        "Accesses witness data — ensure sensitive data is handled correctly",
      );
    }
    if (privacyConsiderations.length === 0) {
      privacyConsiderations.push("No specific privacy concerns identified in this circuit");
    }

    // Default ZK implication
    if (zkImplications.length === 0) {
      zkImplications.push(
        "This circuit generates a zero-knowledge proof that the computation was performed correctly",
      );
    }

    // Build explanation text
    let explanation = `The circuit '${parsed.name}' is a `;
    explanation += parsed.isExported
      ? "public (exported) function that can be called by anyone. "
      : "private (internal) function used by other circuits. ";

    if (parsed.parameters.length > 0) {
      explanation += `It takes ${String(parsed.parameters.length)} parameter(s): `;
      explanation += parsed.parameters.map((p) => `${p.name} (${p.type})`).join(", ");
      explanation += ". ";
    }

    if (parsed.returnType && parsed.returnType !== "Void" && parsed.returnType !== "[]") {
      explanation += `It returns a value of type ${parsed.returnType}. `;
    }

    if (ops.length > 0) {
      explanation += "\n\nKey operations performed:\n";
      ops.forEach((op, i) => {
        explanation += `${String(i + 1)}. ${op}\n`;
      });
    }

    return {
      circuitName: parsed.name,
      isPublic: parsed.isExported,
      isPure: parsed.isPure,
      parameters: parsed.parameters,
      returnType: parsed.returnType,
      explanation,
      operations: ops,
      zkImplications,
      privacyConsiderations,
    };
  });
}
