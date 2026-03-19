import { parseSource } from "../analysis/parser.js";
import { buildSemanticModel } from "../analysis/semantic-model.js";
import type {
  CircuitInfo,
  LedgerState,
  StateChange,
  DeployRequest,
  CallRequest,
  SimulationResult,
} from "./types.js";
import { createSession, getSession } from "./session-manager.js";

export function deployContract(request: DeployRequest): Promise<SimulationResult> {
  return Promise.resolve(_deployContract(request));
}

function _deployContract(request: DeployRequest): SimulationResult {
  if (!request.code || request.code.trim().length === 0) {
    return {
      success: false,
      errors: [{ message: "Contract code is required", severity: "error" }],
    };
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
    if (!session) {
      return {
        success: false,
        errors: [
          {
            message: "Too many active sessions. Try again later.",
            severity: "error",
            errorCode: "CAPACITY_EXCEEDED",
          },
        ],
      };
    }
    if (request.caller) {
      session.caller = request.caller;
    }

    return {
      success: true,
      sessionId: session.id,
      circuits,
      ledgerState: session.ledgerState,
      callHistory: [],
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          message: err instanceof Error ? err.message : "Failed to parse contract",
          severity: "error",
        },
      ],
    };
  }
}

export function callCircuit(sessionId: string, request: CallRequest): Promise<SimulationResult> {
  return Promise.resolve(_callCircuit(sessionId, request));
}

function _callCircuit(sessionId: string, request: CallRequest): SimulationResult {
  const session = getSession(sessionId);
  if (!session) {
    return {
      success: false,
      sessionId,
      errors: [
        {
          message: "Session not found or expired",
          severity: "error",
          errorCode: "SESSION_NOT_FOUND",
        },
      ],
    };
  }

  const circuit = session.circuits.find((c) => c.name === request.circuit);
  if (!circuit) {
    const available = session.circuits.map((c) => c.name).join(", ");
    return {
      success: false,
      sessionId,
      errors: [
        {
          message: `Circuit "${request.circuit}" not found. Available: ${available}`,
          severity: "error",
          errorCode: "CIRCUIT_NOT_FOUND",
        },
      ],
    };
  }

  const stateChanges: StateChange[] = [];

  if (!circuit.isPure) {
    for (const field of circuit.writesLedger) {
      if (!(field in session.ledgerState)) continue;
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

  session.callHistory.push({
    circuit: request.circuit,
    parameters: request.parameters ?? {},
    caller: request.caller ?? session.caller,
    timestamp: Date.now(),
    stateChanges,
  });

  // Return circuits with stateChanges populated on the called circuit
  const circuits = session.circuits.map((c) =>
    c.name === request.circuit ? { ...c, stateChanges } : c,
  );

  return {
    success: true,
    sessionId,
    circuits,
    ledgerState: session.ledgerState,
    callHistory: session.callHistory,
    expiresAt: new Date(session.expiresAt).toISOString(),
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
