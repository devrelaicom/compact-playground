import type { SimulationError } from "../types.js";

export interface LedgerState {
  [field: string]: { type: string; value: string };
}

export interface StateChange {
  field: string;
  operation: string;
  previousValue: string;
  newValue: string;
}

export interface CircuitInfo {
  name: string;
  isPublic: boolean;
  isPure: boolean;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  readsLedger: string[];
  writesLedger: string[];
  stateChanges?: StateChange[];
}

export interface SimulationSession {
  id: string;
  code: string;
  ledgerState: LedgerState;
  circuits: CircuitInfo[];
  callHistory: CircuitCallRecord[];
  createdAt: number;
  expiresAt: number;
  caller?: string;
}

export interface CircuitCallRecord {
  circuit: string;
  parameters: Record<string, string>;
  caller?: string;
  timestamp: number;
  stateChanges: StateChange[];
}

export interface DeployRequest {
  code: string;
  caller?: string;
}

export interface CallRequest {
  circuit: string;
  parameters?: Record<string, string>;
  caller?: string;
}

export interface SimulationResult {
  success: boolean;
  errors?: SimulationError[];
  sessionId?: string;
  circuits?: CircuitInfo[];
  ledgerState?: LedgerState;
  callHistory?: CircuitCallRecord[];
  expiresAt?: string;
}

/** Handle to an instantiated OZ contract simulator. */
export interface SimulatorHandle {
  callPure(name: string, ...args: unknown[]): unknown;
  callImpure(name: string, ...args: unknown[]): unknown;
  getPublicState(): Record<string, unknown>;
  getPrivateState(): unknown;
  getCircuits(): { pure: string[]; impure: string[] };
  setCaller(coinPK: string): void;
  resetCaller(): void;
  cleanup(): Promise<void>;
}
