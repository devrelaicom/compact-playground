import { join } from "path";
import { mkdir } from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { parseSource } from "../analysis/parser.js";
import { compile } from "../compiler.js";
import { getConfig } from "../config.js";
import { createContractSimulator } from "./oz-factory.js";
import type {
  CircuitInfo,
  LedgerState,
  StateChange,
  DeployRequest,
  CallRequest,
  SimulationResult,
} from "./types.js";
import {
  createSession,
  getSession,
  getSimulatorHandle,
  setSimulatorHandle,
} from "./session-manager.js";

export async function deployContract(request: DeployRequest): Promise<SimulationResult> {
  if (!request.code || request.code.trim().length === 0) {
    return {
      success: false,
      errors: [{ message: "Contract code is required", severity: "error" }],
    };
  }

  try {
    const source = parseSource(request.code);

    const { result: compileResult } = await compile(request.code, {
      includeBindings: true,
      skipZk: false,
    });

    if (!compileResult.success) {
      return {
        success: false,
        errors: compileResult.errors?.map((e) => ({
          message: e.message,
          severity: e.severity,
        })) ?? [{ message: "Compilation failed", severity: "error" }],
      };
    }

    if (!compileResult.bindings || Object.keys(compileResult.bindings).length === 0) {
      return {
        success: false,
        errors: [{ message: "Compilation produced no bindings", severity: "error" }],
      };
    }

    const config = getConfig();
    const sessionDir = join(config.tempDir, `sim-${uuidv4()}`);
    await mkdir(sessionDir, { recursive: true });

    let handle;
    try {
      handle = await createContractSimulator(compileResult.bindings, sessionDir);
    } catch (err) {
      return {
        success: false,
        errors: [
          {
            message: `Failed to create simulator: ${err instanceof Error ? err.message : "Unknown error"}`,
            severity: "error",
          },
        ],
      };
    }

    const simCircuits = handle.getCircuits();
    const allSimCircuitNames = new Set([...simCircuits.pure, ...simCircuits.impure]);

    const circuits: CircuitInfo[] = source.circuits
      .filter((c) => allSimCircuitNames.has(c.name))
      .map((c) => ({
        name: c.name,
        isPublic: c.isExported,
        isPure: c.isPure,
        parameters: c.parameters.map((p) => ({ name: p.name, type: p.type })),
        returnType: c.returnType,
        readsLedger: [],
        writesLedger: [],
      }));

    for (const name of allSimCircuitNames) {
      if (!circuits.some((c) => c.name === name)) {
        circuits.push({
          name,
          isPublic: true,
          isPure: simCircuits.pure.includes(name),
          parameters: [],
          returnType: "unknown",
          readsLedger: [],
          writesLedger: [],
        });
      }
    }

    const publicState = handle.getPublicState();
    const ledgerTypeMap = buildLedgerTypeMap(source.ledger);
    const initialLedger = convertPublicState(publicState, ledgerTypeMap);

    const session = createSession(request.code, circuits, initialLedger);
    if (!session) {
      await handle.cleanup();
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

    setSimulatorHandle(session.id, handle);

    if (request.caller) {
      session.caller = request.caller;
      handle.setCaller(request.caller);
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
          message: err instanceof Error ? err.message : "Failed to deploy contract",
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

  const handle = getSimulatorHandle(sessionId);
  if (!handle) {
    return {
      success: false,
      sessionId,
      errors: [
        {
          message: "Simulator instance not found for session",
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

  if (request.caller) {
    handle.setCaller(request.caller);
  }

  const ledgerTypeMap = buildLedgerTypeMapFromState(session.ledgerState);
  const stateBefore = handle.getPublicState();

  const args = convertParameters(circuit.parameters, request.parameters);

  try {
    if (circuit.isPure) {
      handle.callPure(request.circuit, ...args);
    } else {
      handle.callImpure(request.circuit, ...args);
    }
  } catch (err) {
    return {
      success: false,
      sessionId,
      errors: [
        {
          message: `Circuit execution failed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "error",
        },
      ],
    };
  }

  if (request.caller) {
    handle.resetCaller();
    if (session.caller) {
      handle.setCaller(session.caller);
    }
  }

  const stateAfter = handle.getPublicState();
  const stateChanges = computeStateChanges(stateBefore, stateAfter);

  session.ledgerState = convertPublicState(stateAfter, ledgerTypeMap);

  session.callHistory.push({
    circuit: request.circuit,
    parameters: request.parameters ?? {},
    caller: request.caller ?? session.caller,
    timestamp: Date.now(),
    stateChanges,
  });

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

function buildLedgerTypeMap(fields: Array<{ name: string; type: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fields) {
    map.set(f.name, f.type);
  }
  return map;
}

function buildLedgerTypeMapFromState(state: LedgerState): Map<string, string> {
  const map = new Map<string, string>();
  for (const [field, info] of Object.entries(state)) {
    map.set(field, info.type);
  }
  return map;
}

function convertPublicState(
  publicState: Record<string, unknown>,
  typeMap: Map<string, string>,
): LedgerState {
  const result: LedgerState = {};
  for (const [field, value] of Object.entries(publicState)) {
    const type = typeMap.get(field) ?? inferType(value);
    result[field] = {
      type,
      value: valueToString(value),
    };
  }
  return result;
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    return (
      "0x" +
      Array.from(value)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[function]";
  return "unknown";
}

function inferType(value: unknown): string {
  if (typeof value === "bigint") return "Uint<64>";
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number") return "Uint<64>";
  if (value instanceof Uint8Array) return `Bytes<${String(value.length)}>`;
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  return "unknown";
}

function convertParameters(
  paramMeta: Array<{ name: string; type: string }>,
  params?: Record<string, string>,
): unknown[] {
  if (!params || paramMeta.length === 0) return [];
  return paramMeta.map((meta) => {
    if (!(meta.name in params)) return undefined;
    return coerceValue(params[meta.name], meta.type);
  });
}

function coerceValue(value: string, type: string): unknown {
  if (
    type.startsWith("Counter") ||
    type.startsWith("Uint") ||
    type.startsWith("Int") ||
    type === "Field"
  ) {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  if (type === "Boolean" || type === "Bool") {
    return value === "true";
  }
  if (type.startsWith("Bytes")) {
    const hex = value.startsWith("0x") ? value.slice(2) : value;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }
  return value;
}

function computeStateChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): StateChange[] {
  const changes: StateChange[] = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const prevStr = valueToString(before[field]);
    const newStr = valueToString(after[field]);
    if (prevStr !== newStr) {
      changes.push({
        field,
        operation: "write",
        previousValue: prevStr,
        newValue: newStr,
      });
    }
  }
  return changes;
}
