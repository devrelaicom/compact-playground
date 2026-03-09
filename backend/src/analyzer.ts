export interface CircuitInfo {
  name: string;
  exported: boolean;
  pure: boolean;
  params: { name: string; type: string }[];
  returnType: string;
  line: number;
}

export interface LedgerInfo {
  name: string;
  type: string;
  exported: boolean;
}

export interface AnalysisResult {
  pragma: string | null;
  imports: string[];
  circuits: CircuitInfo[];
  ledger: LedgerInfo[];
}

/**
 * Fast source-level analysis — extracts structure without compilation.
 */
export function analyzeSource(code: string): AnalysisResult {
  const result: AnalysisResult = {
    pragma: null,
    imports: [],
    circuits: [],
    ledger: [],
  };

  // Extract pragma
  const pragmaMatch = code.match(/pragma\s+language_version\s+(.+?);/);
  if (pragmaMatch) {
    result.pragma = pragmaMatch[1].trim();
  }

  // Extract imports
  const importRegex = /import\s+(\w+)\s*;/g;
  let importMatch;
  while ((importMatch = importRegex.exec(code)) !== null) {
    result.imports.push(importMatch[1]);
  }

  // Extract circuits
  const circuitRegex =
    /^(\s*)(export\s+)?(pure\s+)?circuit\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+)/gm;
  let circuitMatch;
  while ((circuitMatch = circuitRegex.exec(code)) !== null) {
    const exported = !!circuitMatch[2];
    const pure = !!circuitMatch[3];
    const name = circuitMatch[4];
    const paramsStr = circuitMatch[5].trim();
    const returnType = circuitMatch[6].trim();

    const params = paramsStr
      ? paramsStr.split(",").map((p) => {
          const [pName, pType] = p.split(":").map((s) => s.trim());
          return { name: pName, type: pType };
        })
      : [];

    // Find line number
    const beforeMatch = code.substring(0, circuitMatch.index);
    const line = beforeMatch.split("\n").length;

    result.circuits.push({ name, exported, pure, params, returnType, line });
  }

  // Extract ledger declarations
  const ledgerRegex = /^(\s*)(export\s+)?ledger\s+(\w+)\s*:\s*([^;]+)/gm;
  let ledgerMatch;
  while ((ledgerMatch = ledgerRegex.exec(code)) !== null) {
    result.ledger.push({
      name: ledgerMatch[3],
      type: ledgerMatch[4].trim(),
      exported: !!ledgerMatch[2],
    });
  }

  return result;
}
