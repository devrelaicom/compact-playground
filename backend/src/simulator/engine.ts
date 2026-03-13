import { parseSource } from "../analysis/parser.js";
import { buildSemanticModel } from "../analysis/semantic-model.js";
import type {
  CircuitInfo,
  LedgerState,
  CircuitCallRecord,
  DeployRequest,
  CallRequest,
} from "./types.js";
import { createSession, getSession } from "./session-manager.js";

interface DeployResult {
  success: boolean;
  sessionId?: string;
  circuits?: CircuitInfo[];
  ledgerState?: LedgerState;
  error?: string;
}

interface CallResult {
  success: boolean;
  circuit?: string;
  stateChanges?: CircuitCallRecord["stateChanges"];
  ledgerState?: LedgerState;
  callHistory?: CircuitCallRecord[];
  error?: string;
}

export function deployContract(request: DeployRequest): Promise<DeployResult> {
  return Promise.resolve(_deployContract(request));
}

function _deployContract(request: DeployRequest): DeployResult {
  if (!request.code || request.code.trim().length === 0) {
    return { success: false, error: "Contract code is required" };
  }

  try {
    const source = parseSource(request.code);
    const model = buildSemanticModel(source);

    const circuits: CircuitInfo[] = model.circuits.map((c) => ({
      name: c.parsed.name,
      isPublic: c.parsed.isExported,
      isPure: c.parsed.isPure,
      parameters: c.parsed.parameters.map((p) => ({ name: p.name, type: p.type })),
      returnType: c.parsed.returnType,
      readsLedger: c.operations.readsLedger,
      writesLedger: c.operations.writesLedger,
    }));

    const initialLedger: LedgerState = {};
    for (const field of source.ledger) {
      initialLedger[field.name] = {
        type: field.type,
        value: getDefaultValue(field.type),
      };
    }

    const session = createSession(request.code, circuits, initialLedger);
    if (request.caller) {
      session.caller = request.caller;
    }

    return {
      success: true,
      sessionId: session.id,
      circuits,
      ledgerState: session.ledgerState,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to parse contract",
    };
  }
}

export function callCircuit(sessionId: string, request: CallRequest): Promise<CallResult> {
  return Promise.resolve(_callCircuit(sessionId, request));
}

function _callCircuit(sessionId: string, request: CallRequest): CallResult {
  const session = getSession(sessionId);
  if (!session) {
    return { success: false, error: "Session not found or expired" };
  }

  const circuit = session.circuits.find((c) => c.name === request.circuit);
  if (!circuit) {
    const available = session.circuits.map((c) => c.name).join(", ");
    return {
      success: false,
      error: `Circuit "${request.circuit}" not found. Available: ${available}`,
    };
  }

  const stateChanges: CircuitCallRecord["stateChanges"] = [];

  if (!circuit.isPure) {
    for (const field of circuit.writesLedger) {
      const current = session.ledgerState[field];
      const previousValue = current.value;
      const newValue = simulateMutation(current, request.parameters);
      session.ledgerState[field] = { ...current, value: newValue };

      stateChanges.push({
        field,
        operation: "write",
        previousValue,
        newValue,
      });
    }
  }

  const record: CircuitCallRecord = {
    circuit: request.circuit,
    parameters: request.parameters ?? {},
    caller: request.caller ?? session.caller,
    timestamp: Date.now(),
    stateChanges,
  };

  session.callHistory.push(record);

  return {
    success: true,
    circuit: request.circuit,
    stateChanges,
    ledgerState: session.ledgerState,
    callHistory: session.callHistory,
  };
}

function getDefaultValue(type: string): string {
  if (type.startsWith("Counter") || type.startsWith("Uint") || type.startsWith("Int")) {
    return "0";
  }
  if (type.startsWith("Bytes") || type === "Field") {
    return "0x0";
  }
  if (type === "Boolean" || type === "Bool") {
    return "false";
  }
  if (type.startsWith("Map") || type.startsWith("Set")) {
    return "{}";
  }
  return "undefined";
}

function simulateMutation(
  current: { type: string; value: string },
  params?: Record<string, string>,
): string {
  if (current.type.startsWith("Counter") || current.type.startsWith("Uint")) {
    const currentVal = BigInt(current.value || "0");
    if (params) {
      const amount = Object.values(params).find((v) => /^\d+$/.test(v));
      if (amount) {
        return String(currentVal + BigInt(amount));
      }
    }
    return String(currentVal + 1n);
  }
  return current.value;
}
