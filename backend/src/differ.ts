import { parseSource } from "./analysis/parser.js";
import { getFileCache, generateCacheKey } from "./cache.js";
import type { ParsedCircuit, ParsedLedgerField } from "./analysis/types.js";

export interface CircuitDiff {
  name: string;
  changes: string[]; // which aspects changed: "params", "returnType", "exported", "pure"
  before?: ParsedCircuit;
  after?: ParsedCircuit;
}

export interface LedgerDiff {
  name: string;
  before?: string;
  after?: string;
}

export interface DiffResult {
  hasChanges: boolean;
  circuits: {
    added: ParsedCircuit[];
    removed: ParsedCircuit[];
    modified: CircuitDiff[];
  };
  ledger: {
    added: ParsedLedgerField[];
    removed: ParsedLedgerField[];
    modified: LedgerDiff[];
  };
  pragma: {
    before: string | null;
    after: string | null;
    changed: boolean;
  };
  imports: {
    added: string[];
    removed: string[];
  };
  cacheKey?: string;
}

export async function diffContracts(before: string, after: string): Promise<DiffResult> {
  // Check cache
  const cache = getFileCache();
  const cacheKey = cache ? generateCacheKey(before + "\x00" + after, "none", {}) : null;

  if (cache && cacheKey) {
    const cached = await cache.get<DiffResult>("diff", cacheKey);
    if (cached) {
      return cached;
    }
  }

  const beforeAnalysis = parseSource(before);
  const afterAnalysis = parseSource(after);

  // Diff circuits
  const beforeCircuits = new Map(beforeAnalysis.circuits.map((c) => [c.name, c]));
  const afterCircuits = new Map(afterAnalysis.circuits.map((c) => [c.name, c]));

  const addedCircuits = afterAnalysis.circuits.filter((c) => !beforeCircuits.has(c.name));
  const removedCircuits = beforeAnalysis.circuits.filter((c) => !afterCircuits.has(c.name));

  const modifiedCircuits: CircuitDiff[] = [];
  for (const [name, beforeCircuit] of beforeCircuits) {
    const afterCircuit = afterCircuits.get(name);
    if (!afterCircuit) continue;

    const changes: string[] = [];
    if (JSON.stringify(beforeCircuit.parameters) !== JSON.stringify(afterCircuit.parameters)) {
      changes.push("params");
    }
    if (beforeCircuit.returnType !== afterCircuit.returnType) {
      changes.push("returnType");
    }
    if (beforeCircuit.isExported !== afterCircuit.isExported) {
      changes.push("exported");
    }
    if (beforeCircuit.isPure !== afterCircuit.isPure) {
      changes.push("pure");
    }

    if (changes.length > 0) {
      modifiedCircuits.push({ name, changes, before: beforeCircuit, after: afterCircuit });
    }
  }

  // Diff ledger
  const beforeLedger = new Map(beforeAnalysis.ledger.map((l) => [l.name, l]));
  const afterLedger = new Map(afterAnalysis.ledger.map((l) => [l.name, l]));

  const addedLedger = afterAnalysis.ledger.filter((l) => !beforeLedger.has(l.name));
  const removedLedger = beforeAnalysis.ledger.filter((l) => !afterLedger.has(l.name));

  const modifiedLedger: LedgerDiff[] = [];
  for (const [name, beforeField] of beforeLedger) {
    const afterField = afterLedger.get(name);
    if (!afterField) continue;

    if (beforeField.type !== afterField.type) {
      modifiedLedger.push({ name, before: beforeField.type, after: afterField.type });
    }
  }

  // Diff imports
  const beforeImports = new Set(beforeAnalysis.imports);
  const afterImports = new Set(afterAnalysis.imports);
  const addedImports = afterAnalysis.imports.filter((i) => !beforeImports.has(i));
  const removedImports = beforeAnalysis.imports.filter((i) => !afterImports.has(i));

  // Diff pragma
  const pragmaChanged = beforeAnalysis.pragma !== afterAnalysis.pragma;

  const hasChanges =
    addedCircuits.length > 0 ||
    removedCircuits.length > 0 ||
    modifiedCircuits.length > 0 ||
    addedLedger.length > 0 ||
    removedLedger.length > 0 ||
    modifiedLedger.length > 0 ||
    addedImports.length > 0 ||
    removedImports.length > 0 ||
    pragmaChanged;

  const result: DiffResult = {
    hasChanges,
    circuits: { added: addedCircuits, removed: removedCircuits, modified: modifiedCircuits },
    ledger: { added: addedLedger, removed: removedLedger, modified: modifiedLedger },
    pragma: { before: beforeAnalysis.pragma, after: afterAnalysis.pragma, changed: pragmaChanged },
    imports: { added: addedImports, removed: removedImports },
    cacheKey: cacheKey ?? undefined,
  };

  if (cache && cacheKey) {
    await cache.set("diff", cacheKey, result);
  }

  return result;
}
