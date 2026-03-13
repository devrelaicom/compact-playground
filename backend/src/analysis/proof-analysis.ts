import type {
  SemanticModel,
  ParsedLedgerField,
  SemanticCircuit,
  CircuitOperations,
  ParsedCircuit,
} from "./types.js";

// ── Types ───────────────────────────────────────────────────────────

export interface PrivacyBoundaryItem {
  name: string;
  type: string;
  side: "prover" | "verifier" | "both";
  reason: string;
}

export interface ConstraintDescription {
  description: string;
  humanReadable: string;
}

export interface ProofFlowStep {
  actor: "prover" | "verifier" | "chain";
  action: string;
  detail: string;
  dataVisible: string[];
  dataHidden: string[];
}

export interface CircuitProofAnalysis {
  circuit: string;
  isPublic: boolean;
  isPure: boolean;
  proverKnows: PrivacyBoundaryItem[];
  verifierSees: PrivacyBoundaryItem[];
  constraints: ConstraintDescription[];
  privacyBoundary: PrivacyBoundaryItem[];
  proofFlow: ProofFlowStep[];
  narrative: string;
}

export interface ProofAnalysisResponse {
  success: boolean;
  contract: {
    publicState: Array<{ name: string; type: string }>;
    privateState: Array<{ name: string; type: string }>;
  };
  circuits: CircuitProofAnalysis[];
  cacheKey?: string;
}

// ── Main entry point ────────────────────────────────────────────────

export function buildProofAnalysis(model: SemanticModel): ProofAnalysisResponse {
  const publicState = model.source.ledger
    .filter((l) => l.isExported)
    .map((l) => ({ name: l.name, type: l.type }));
  const privateState = model.source.ledger
    .filter((l) => !l.isExported)
    .map((l) => ({ name: l.name, type: l.type }));

  const circuits = model.circuits.map((sc) => analyzeCircuitPrivacy(sc, model.source.ledger));

  return { success: true, contract: { publicState, privateState }, circuits };
}

// ── Per-circuit analysis ────────────────────────────────────────────

function analyzeCircuitPrivacy(
  sc: SemanticCircuit,
  ledgerFields: ParsedLedgerField[],
): CircuitProofAnalysis {
  const { parsed, operations } = sc;

  const proverKnows = buildProverKnows(parsed, operations, ledgerFields);
  const verifierSees = buildVerifierSees(parsed, operations, ledgerFields);
  const privacyBoundary = buildPrivacyBoundary(proverKnows, verifierSees);
  const constraints = buildConstraints(parsed, operations);
  const proofFlow = buildProofFlow(parsed, operations, ledgerFields);
  const narrative = buildNarrative(parsed, operations, ledgerFields);

  return {
    circuit: parsed.name,
    isPublic: parsed.isExported,
    isPure: parsed.isPure,
    proverKnows,
    verifierSees,
    constraints,
    privacyBoundary,
    proofFlow,
    narrative,
  };
}

// ── Prover knowledge ────────────────────────────────────────────────

function buildProverKnows(
  parsed: ParsedCircuit,
  operations: CircuitOperations,
  ledgerFields: ParsedLedgerField[],
): PrivacyBoundaryItem[] {
  const items: PrivacyBoundaryItem[] = [];

  // Parameters are private inputs known to the prover
  for (const param of parsed.parameters) {
    items.push({
      name: param.name,
      type: param.type,
      side: "prover",
      reason: "Circuit parameter (private input)",
    });
  }

  // Private ledger reads are prover-only
  for (const fieldName of operations.readsLedger) {
    const field = ledgerFields.find((l) => l.name === fieldName);
    if (field && !field.isExported) {
      items.push({
        name: field.name,
        type: field.type,
        side: "prover",
        reason: "Private ledger state (not visible on-chain)",
      });
    }
  }

  // Witnesses are prover-only
  for (const witnessName of operations.usesWitnesses) {
    items.push({
      name: witnessName,
      type: "Witness",
      side: "prover",
      reason: "Witness value (off-chain private data)",
    });
  }

  return items;
}

// ── Verifier visibility ─────────────────────────────────────────────

function buildVerifierSees(
  parsed: ParsedCircuit,
  operations: CircuitOperations,
  ledgerFields: ParsedLedgerField[],
): PrivacyBoundaryItem[] {
  const items: PrivacyBoundaryItem[] = [];

  // Public ledger writes are visible on-chain
  for (const fieldName of operations.writesLedger) {
    const field = ledgerFields.find((l) => l.name === fieldName);
    if (field && field.isExported) {
      items.push({
        name: field.name,
        type: field.type,
        side: "verifier",
        reason: "Public ledger state change (visible on-chain)",
      });
    }
  }

  // Public ledger reads are visible on-chain
  for (const fieldName of operations.readsLedger) {
    const field = ledgerFields.find((l) => l.name === fieldName);
    if (field && field.isExported) {
      // Avoid duplicates if already added as a write
      if (!items.some((i) => i.name === field.name)) {
        items.push({
          name: field.name,
          type: field.type,
          side: "verifier",
          reason: "Public ledger state (readable on-chain)",
        });
      }
    }
  }

  // Return type of public non-void circuits is visible
  if (
    parsed.isExported &&
    parsed.returnType &&
    parsed.returnType !== "Void" &&
    parsed.returnType !== "[]"
  ) {
    items.push({
      name: "returnValue",
      type: parsed.returnType,
      side: "verifier",
      reason: "Public circuit return value",
    });
  }

  // Disclosed data is visible
  if (operations.usesDisclose) {
    items.push({
      name: "disclosedData",
      type: "disclosed",
      side: "verifier",
      reason: "Data explicitly revealed via disclose()",
    });
  }

  return items;
}

// ── Privacy boundary ────────────────────────────────────────────────

function buildPrivacyBoundary(
  proverKnows: PrivacyBoundaryItem[],
  verifierSees: PrivacyBoundaryItem[],
): PrivacyBoundaryItem[] {
  const boundary: PrivacyBoundaryItem[] = [];
  const verifierNames = new Set(verifierSees.map((v) => v.name));
  const proverNames = new Set(proverKnows.map((p) => p.name));

  // Items known to prover
  for (const item of proverKnows) {
    if (verifierNames.has(item.name)) {
      boundary.push({
        ...item,
        side: "both",
        reason: "Crosses privacy boundary — known to prover, visible to verifier",
      });
    } else {
      boundary.push({ ...item });
    }
  }

  // Items visible to verifier but not already added
  for (const item of verifierSees) {
    if (!proverNames.has(item.name)) {
      boundary.push({ ...item });
    }
  }

  return boundary;
}

// ── Constraints ─────────────────────────────────────────────────────

function describeConstraint(expr: string): string {
  const trimmed = expr.trim();
  if (trimmed.includes(">=")) {
    const [left, right] = trimmed.split(">=").map((s) => s.trim());
    return `${left} must be greater than or equal to ${right}`;
  }
  if (trimmed.includes("<=")) {
    const [left, right] = trimmed.split("<=").map((s) => s.trim());
    return `${left} must be less than or equal to ${right}`;
  }
  if (trimmed.includes("!=")) {
    const [left, right] = trimmed.split("!=").map((s) => s.trim());
    return `${left} must not equal ${right}`;
  }
  if (trimmed.includes("==")) {
    const [left, right] = trimmed.split("==").map((s) => s.trim());
    return `${left} must equal ${right}`;
  }
  return `Constraint: ${trimmed}`;
}

function buildConstraints(
  parsed: ParsedCircuit,
  operations: CircuitOperations,
): ConstraintDescription[] {
  const constraints: ConstraintDescription[] = [];

  // Extract assert expressions from body
  const assertRegex = /assert\s*\(([^)]+)\)/g;
  let match;
  while ((match = assertRegex.exec(parsed.body)) !== null) {
    const expr = match[1];
    constraints.push({
      description: `assert(${expr})`,
      humanReadable: describeConstraint(expr),
    });
  }

  // Commit constraints
  if (operations.usesCommit) {
    constraints.push({
      description: "commit()",
      humanReadable: "Creates a cryptographic commitment that binds the prover to a value",
    });
  }

  // Hash constraints
  if (operations.usesHash) {
    constraints.push({
      description: "hash()",
      humanReadable: "Computes a cryptographic hash as an in-circuit constraint",
    });
  }

  return constraints;
}

// ── Proof flow ──────────────────────────────────────────────────────

function buildProofFlow(
  parsed: ParsedCircuit,
  operations: CircuitOperations,
  ledgerFields: ParsedLedgerField[],
): ProofFlowStep[] {
  const steps: ProofFlowStep[] = [];
  const paramNames = parsed.parameters.map((p) => p.name);
  const publicFields = ledgerFields
    .filter((l) => l.isExported && operations.readsLedger.includes(l.name))
    .map((l) => l.name);
  const privateFields = ledgerFields
    .filter((l) => !l.isExported && operations.readsLedger.includes(l.name))
    .map((l) => l.name);
  const writtenFields = operations.writesLedger;

  // Step 1: Prover prepares inputs
  if (paramNames.length > 0) {
    steps.push({
      actor: "prover",
      action: "Prepare inputs",
      detail: `Prover assembles private inputs: ${paramNames.join(", ")}`,
      dataVisible: [],
      dataHidden: paramNames,
    });
  }

  // Step 2: Read ledger
  if (operations.readsLedger.length > 0) {
    steps.push({
      actor: "prover",
      action: "Read ledger state",
      detail: `Prover reads ledger fields: ${operations.readsLedger.join(", ")}`,
      dataVisible: publicFields,
      dataHidden: privateFields,
    });
  }

  // Step 3: Evaluate constraints
  if (operations.usesAssert) {
    steps.push({
      actor: "prover",
      action: "Evaluate constraints",
      detail: "Prover evaluates all assert() constraints within the circuit",
      dataVisible: [],
      dataHidden: paramNames,
    });
  }

  // Step 4: Compute state changes
  if (writtenFields.length > 0) {
    steps.push({
      actor: "prover",
      action: "Compute state changes",
      detail: `Prover computes new values for: ${writtenFields.join(", ")}`,
      dataVisible: writtenFields.filter((f) => {
        const field = ledgerFields.find((l) => l.name === f);
        return field?.isExported;
      }),
      dataHidden: writtenFields.filter((f) => {
        const field = ledgerFields.find((l) => l.name === f);
        return !field?.isExported;
      }),
    });
  }

  // Step 5: Generate proof
  steps.push({
    actor: "prover",
    action: "Generate proof",
    detail: "Prover generates a zero-knowledge proof of correct execution",
    dataVisible: [],
    dataHidden: [...paramNames, ...privateFields],
  });

  // Step 6: Verifier verifies
  steps.push({
    actor: "verifier",
    action: "Verify proof",
    detail: "Verifier checks the proof without learning private inputs",
    dataVisible: publicFields,
    dataHidden: [],
  });

  // Step 7: Chain records
  if (writtenFields.length > 0) {
    const publicWrites = writtenFields.filter((f) => {
      const field = ledgerFields.find((l) => l.name === f);
      return field?.isExported;
    });
    steps.push({
      actor: "chain",
      action: "Record on chain",
      detail: `Blockchain records updated state${publicWrites.length > 0 ? `: ${publicWrites.join(", ")}` : ""}`,
      dataVisible: publicWrites,
      dataHidden: [],
    });
  }

  return steps;
}

// ── Narrative ───────────────────────────────────────────────────────

function buildNarrative(
  parsed: ParsedCircuit,
  operations: CircuitOperations,
  ledgerFields: ParsedLedgerField[],
): string {
  const name = parsed.name;

  // Pure circuits: simple read narrative
  if (parsed.isPure) {
    const reads = operations.readsLedger;
    if (reads.length > 0) {
      return `The pure circuit '${name}' reads ${reads.join(", ")} from the ledger without modifying any state. Since it is pure, no proof is generated — the result is computed directly.`;
    }
    return `The pure circuit '${name}' performs a read-only computation without modifying state.`;
  }

  // Mutating circuits
  const parts: string[] = [];
  parts.push(`The circuit '${name}'`);

  if (parsed.parameters.length > 0) {
    const paramList = parsed.parameters.map((p) => `${p.name} (${p.type})`).join(", ");
    parts.push(`takes private inputs ${paramList}`);
  }

  if (operations.writesLedger.length > 0) {
    const publicWrites = operations.writesLedger.filter((f) => {
      const field = ledgerFields.find((l) => l.name === f);
      return field?.isExported;
    });
    const privateWrites = operations.writesLedger.filter((f) => {
      const field = ledgerFields.find((l) => l.name === f);
      return !field?.isExported;
    });

    if (publicWrites.length > 0) {
      parts.push(`modifies public state (${publicWrites.join(", ")})`);
    }
    if (privateWrites.length > 0) {
      parts.push(`modifies private state (${privateWrites.join(", ")})`);
    }
  }

  if (operations.usesAssert) {
    parts.push("enforces constraints via assert()");
  }

  if (operations.usesDisclose) {
    parts.push("reveals selected data via disclose()");
  }

  let narrative = parts.join(", ") + ".";

  // Add privacy summary
  const privateInputs = parsed.parameters.map((p) => p.name);
  const publicOutputs = operations.writesLedger.filter((f) => {
    const field = ledgerFields.find((l) => l.name === f);
    return field?.isExported;
  });

  if (privateInputs.length > 0 && publicOutputs.length > 0) {
    narrative += ` The prover demonstrates knowledge of ${privateInputs.join(", ")} while only revealing the effect on ${publicOutputs.join(", ")}.`;
  } else if (privateInputs.length > 0) {
    narrative += ` The prover's inputs (${privateInputs.join(", ")}) remain hidden from the verifier.`;
  }

  return narrative;
}
