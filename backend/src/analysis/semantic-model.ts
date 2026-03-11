// backend/src/analysis/semantic-model.ts
import type { ParsedSource, SemanticModel, SemanticCircuit, CircuitOperations } from "./types.js";
import { locationAt } from "./parser.js";

function analyzeCircuitBody(
  circuit: ParsedSource["circuits"][0],
  source: ParsedSource,
): CircuitOperations {
  const body = circuit.body;
  const bodyOffset = circuit.bodySpan.start.offset;
  const ledgerNames = source.ledger.map((l) => l.name);
  const witnessNames = source.witnesses.map((w) => w.name);

  const ops: CircuitOperations = {
    readsLedger: [],
    writesLedger: [],
    usesDisclose: false,
    usesCommit: false,
    usesHash: false,
    usesAssert: false,
    usesWitnesses: [],
    ledgerMutations: [],
  };

  // Detect privacy/crypto operations
  if (/\bdisclose\s*\(/.test(body)) ops.usesDisclose = true;
  if (/\bcommit\s*\(/.test(body)) ops.usesCommit = true;
  if (/\bhash\s*\(/.test(body)) ops.usesHash = true;
  if (/\bassert\s*\(/.test(body)) ops.usesAssert = true;

  // Detect ledger field references and mutations
  for (const fieldName of ledgerNames) {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Check for any reference (read)
    if (new RegExp(`\\b${escaped}\\b`).test(body)) {
      ops.readsLedger.push(fieldName);
    }

    // Check for mutations
    const mutationPatterns: Array<{
      pattern: RegExp;
      operation: CircuitOperations["ledgerMutations"][0]["operation"];
    }> = [
      { pattern: new RegExp(`\\b${escaped}\\.insert\\s*\\(`, "g"), operation: "insert" },
      { pattern: new RegExp(`\\b${escaped}\\.increment\\s*\\(`, "g"), operation: "increment" },
      { pattern: new RegExp(`\\b${escaped}\\.decrement\\s*\\(`, "g"), operation: "decrement" },
      { pattern: new RegExp(`\\b${escaped}\\s*=(?!=)`, "g"), operation: "assign" },
    ];

    for (const { pattern, operation } of mutationPatterns) {
      let match;
      while ((match = pattern.exec(body)) !== null) {
        if (!ops.writesLedger.includes(fieldName)) {
          ops.writesLedger.push(fieldName);
        }
        ops.ledgerMutations.push({
          field: fieldName,
          operation,
          location: locationAt(source.code, bodyOffset + match.index, source.lineByIndex),
        });
      }
    }
  }

  // Detect witness usage
  for (const witnessName of witnessNames) {
    const escaped = witnessName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(body)) {
      ops.usesWitnesses.push(witnessName);
    }
  }

  return ops;
}

export function buildSemanticModel(source: ParsedSource): SemanticModel {
  const circuits: SemanticCircuit[] = source.circuits.map((circuit) => ({
    parsed: circuit,
    operations: analyzeCircuitBody(circuit, source),
  }));

  // Find unused witnesses
  const usedWitnesses = new Set<string>();
  for (const c of circuits) {
    for (const w of c.operations.usesWitnesses) {
      usedWitnesses.add(w);
    }
  }
  // Also check constructor body for witness usage
  if (source.constructor) {
    for (const w of source.witnesses) {
      const escaped = w.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`).test(source.constructor.body)) {
        usedWitnesses.add(w.name);
      }
    }
  }
  const unusedWitnesses = source.witnesses
    .map((w) => w.name)
    .filter((name) => !usedWitnesses.has(name));

  return {
    source,
    circuits,
    unusedWitnesses,
    hasStdLibImport: source.imports.includes("CompactStandardLibrary"),
  };
}
