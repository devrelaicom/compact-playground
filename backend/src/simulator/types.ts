export interface LedgerState {
  [field: string]: { type: string; value: string };
}

export interface CircuitInfo {
  name: string;
  isPublic: boolean;
  isPure: boolean;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  readsLedger: string[];
  writesLedger: string[];
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
  stateChanges: Array<{
    field: string;
    operation: string;
    previousValue: string;
    newValue: string;
  }>;
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
