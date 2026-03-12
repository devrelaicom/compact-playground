// backend/src/analysis/parser.ts
import type {
  ParsedSource,
  ParsedCircuit,
  ParsedWitness,
  ParsedLedgerField,
  ParsedTypeAlias,
  ParsedStruct,
  ParsedEnum,
  ParsedConstructor,
  ParsedParameter,
  ParseDiagnostic,
  SourceLocation,
  SourceSpan,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a mapping from character index to 1-based line number.
 */
export function buildLineByIndex(code: string): number[] {
  const lineByIndex = new Array<number>(code.length + 1).fill(1);
  let currentLine = 1;
  for (let i = 0; i < code.length; i++) {
    lineByIndex[i] = currentLine;
    if (code[i] === "\n") currentLine++;
  }
  lineByIndex[code.length] = currentLine;
  return lineByIndex;
}

/**
 * Compute column (0-based) for a character offset.
 */
function columnAt(code: string, offset: number): number {
  const lastNewline = code.lastIndexOf("\n", offset - 1);
  return lastNewline === -1 ? offset : offset - lastNewline - 1;
}

/**
 * Build a SourceLocation from a character offset.
 * Exported for reuse by semantic-model.ts and rules.ts.
 */
export function locationAt(code: string, offset: number, lineByIndex: number[]): SourceLocation {
  return {
    line: lineByIndex[offset] ?? 1,
    column: columnAt(code, offset),
    offset,
  };
}

/**
 * Split parameters handling nested angle brackets, square brackets,
 * parentheses, and string literals.
 */
export function splitParams(paramsStr: string): string[] {
  const result: string[] = [];
  let current = "";
  let angleDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < paramsStr.length; i++) {
    const ch = paramsStr[i] ?? "";

    if ((ch === '"' || ch === "'") && (i === 0 || paramsStr[i - 1] !== "\\")) {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = "";
      }
    }

    if (!inString) {
      if (ch === "<") angleDepth++;
      else if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
      else if (ch === "[") squareDepth++;
      else if (ch === "]") squareDepth = Math.max(0, squareDepth - 1);
      else if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    }

    if (ch === "," && !inString && angleDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/**
 * Parse "name: Type" parameter strings into structured objects.
 */
function parseParameterList(paramsStr: string): ParsedParameter[] {
  if (!paramsStr.trim()) return [];
  const parts = splitParams(paramsStr);
  return parts.map((p) => {
    const colonIdx = p.indexOf(":");
    if (colonIdx === -1) return { name: p.trim(), type: "unknown" };
    return {
      name: p.substring(0, colonIdx).trim(),
      type: p.substring(colonIdx + 1).trim(),
    };
  });
}

/**
 * Extract the contents of a balanced brace block starting at `startIndex`.
 */
export function extractBalancedBlock(
  source: string,
  startIndex: number,
): { body: string; endIndex: number } | null {
  if (source[startIndex] !== "{") return null;

  let depth = 1;
  let i = startIndex + 1;
  const bodyStart = i;

  while (i < source.length && depth > 0) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : "";

    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\" && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Skip line comments
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    // Skip block comments
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      if (i < source.length) i += 2;
      continue;
    }

    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { body: source.slice(bodyStart, i), endIndex: i };
      }
      i++;
      continue;
    }
    i++;
  }
  return null;
}

// ── Main Parser ──────────────────────────────────────────────────────

export function parseSource(code: string): ParsedSource {
  const lineByIndex = buildLineByIndex(code);
  const lines = code.split("\n");
  const diagnostics: ParseDiagnostic[] = [];

  // ── Pragma ──
  let pragma: string | null = null;
  let pragmaVersion: string | null = null;
  const pragmaMatch = code.match(/pragma\s+language_version\s+(.+?);/);
  if (pragmaMatch) {
    pragma = pragmaMatch[1].trim();
    const versionMatch = pragma.match(/([\d.]+)/);
    pragmaVersion = versionMatch?.[1] ?? null;
  }

  // ── Imports ──
  const imports: string[] = [];
  const importRegex = /import\s+(\w+)\s*;/g;
  let importMatch;
  while ((importMatch = importRegex.exec(code)) !== null) {
    imports.push(importMatch[1]);
  }

  // ── Circuits ──
  const circuits: ParsedCircuit[] = [];
  const circuitPattern = /(?:(export)\s+)?(?:(pure)\s+)?circuit\s+(\w+)\s*\(/g;
  let circuitMatch;
  while ((circuitMatch = circuitPattern.exec(code)) !== null) {
    const isExported = circuitMatch[1] === "export";
    const isPure = circuitMatch[2] === "pure";
    const name = circuitMatch[3];
    const loc = locationAt(code, circuitMatch.index, lineByIndex);

    // Extract parameters by finding matching closing paren
    const paramsStart = circuitMatch.index + circuitMatch[0].length;
    let depth = 1;
    let paramsEnd = paramsStart;
    while (paramsEnd < code.length && depth > 0) {
      if (code[paramsEnd] === "(") depth++;
      else if (code[paramsEnd] === ")") depth--;
      paramsEnd++;
    }
    const paramsStr = code.substring(paramsStart, paramsEnd - 1);
    const parameters = parseParameterList(paramsStr);

    // Extract return type
    const afterParams = code.substring(paramsEnd);
    const returnTypeMatch = afterParams.match(/^\s*:\s*([^{\n;]+)/);
    const returnType = returnTypeMatch?.[1]?.trim() ?? "[]";

    // Extract body
    const braceIdx = code.indexOf("{", paramsEnd);
    let body = "";
    let bodySpan: SourceSpan = { start: loc, end: loc };
    if (braceIdx !== -1) {
      const block = extractBalancedBlock(code, braceIdx);
      if (block) {
        body = block.body;
        bodySpan = {
          start: locationAt(code, braceIdx + 1, lineByIndex),
          end: locationAt(code, block.endIndex, lineByIndex),
        };
      }
    }

    circuits.push({
      name,
      isExported,
      isPure,
      parameters,
      returnType,
      location: loc,
      body,
      bodySpan,
    });
  }

  // ── Witnesses ──
  const witnesses: ParsedWitness[] = [];
  const witnessPattern = /(?:(export)\s+)?witness\s+(\w+)\s*:\s*([^;]+)/g;
  let witnessMatch;
  while ((witnessMatch = witnessPattern.exec(code)) !== null) {
    const loc = locationAt(code, witnessMatch.index, lineByIndex);
    const typeStr = witnessMatch[3].trim();

    // Parse witness type as (params) => returnType
    let parameters: ParsedParameter[] = [];
    let returnType = typeStr;
    const arrowMatch = typeStr.match(/^\(([^)]*)\)\s*=>\s*(.+)$/);
    if (arrowMatch) {
      parameters = parseParameterList(arrowMatch[1]);
      returnType = arrowMatch[2].trim();
    }

    witnesses.push({
      name: witnessMatch[2],
      isExported: witnessMatch[1] === "export",
      parameters,
      returnType,
      location: loc,
    });
  }

  // ── Ledger Fields ──
  const ledger: ParsedLedgerField[] = [];
  const ledgerPattern = /(?:(export)\s+)?(?:(sealed)\s+)?ledger\s+(\w+)\s*:\s*([^;]+)/g;
  let ledgerMatch;
  while ((ledgerMatch = ledgerPattern.exec(code)) !== null) {
    const loc = locationAt(code, ledgerMatch.index, lineByIndex);
    ledger.push({
      name: ledgerMatch[3],
      type: ledgerMatch[4].trim(),
      isExported: ledgerMatch[1] === "export",
      isSealed: ledgerMatch[2] === "sealed",
      location: loc,
    });
  }

  // ── Type Aliases ──
  const types: ParsedTypeAlias[] = [];
  const typePattern = /(?:(export)\s+)?type\s+(\w+)\s*=\s*([^;]+)/g;
  let typeMatch;
  while ((typeMatch = typePattern.exec(code)) !== null) {
    const loc = locationAt(code, typeMatch.index, lineByIndex);
    types.push({
      name: typeMatch[2],
      definition: typeMatch[3].trim(),
      location: loc,
    });
  }

  // ── Structs ──
  const structs: ParsedStruct[] = [];
  const structPattern = /(?:(export)\s+)?struct\s+(\w+)\s*\{/g;
  let structMatch;
  while ((structMatch = structPattern.exec(code)) !== null) {
    const loc = locationAt(code, structMatch.index, lineByIndex);
    const braceIdx = code.indexOf("{", structMatch.index);
    if (braceIdx === -1) continue;
    const block = extractBalancedBlock(code, braceIdx);
    if (!block) continue;
    const fields = block.body
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f);
    structs.push({
      name: structMatch[2],
      isExported: structMatch[1] === "export",
      fields,
      location: loc,
    });
  }

  // ── Enums ──
  const enums: ParsedEnum[] = [];
  const enumPattern = /(?:(export)\s+)?enum\s+(\w+)\s*\{/g;
  let enumMatch;
  while ((enumMatch = enumPattern.exec(code)) !== null) {
    const loc = locationAt(code, enumMatch.index, lineByIndex);
    const braceIdx = code.indexOf("{", enumMatch.index);
    if (braceIdx === -1) continue;
    const block = extractBalancedBlock(code, braceIdx);
    if (!block) continue;
    const variants = block.body
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v);
    enums.push({
      name: enumMatch[2],
      isExported: enumMatch[1] === "export",
      variants,
      location: loc,
    });
  }

  // ── Constructor ──
  let constructor: ParsedConstructor | null = null;
  const constructorPattern = /constructor\s*(?:\(([^)]*)\))?\s*\{/g;
  const constructorMatch = constructorPattern.exec(code);
  if (constructorMatch) {
    const loc = locationAt(code, constructorMatch.index, lineByIndex);
    const paramsStr = constructorMatch[1] || "";
    const parameters = parseParameterList(paramsStr);
    const braceIdx = code.indexOf("{", constructorMatch.index + "constructor".length);
    let body = "";
    let bodySpan: SourceSpan = { start: loc, end: loc };
    if (braceIdx !== -1) {
      const block = extractBalancedBlock(code, braceIdx);
      if (block) {
        body = block.body;
        bodySpan = {
          start: locationAt(code, braceIdx + 1, lineByIndex),
          end: locationAt(code, block.endIndex, lineByIndex),
        };
      }
    }
    constructor = { parameters, body, bodySpan, location: loc };
  }

  // ── Exports (collect all exported names) ──
  const exports: string[] = [];
  for (const c of circuits) {
    if (c.isExported) exports.push(c.name);
  }
  for (const l of ledger) {
    if (l.isExported) exports.push(l.name);
  }
  for (const w of witnesses) {
    if (w.isExported) exports.push(w.name);
  }
  for (const t of types) {
    exports.push(t.name);
  } // type aliases are always visible
  for (const s of structs) {
    if (s.isExported) exports.push(s.name);
  }
  for (const e of enums) {
    if (e.isExported) exports.push(e.name);
  }

  return {
    pragma,
    pragmaVersion,
    imports,
    exports,
    circuits,
    witnesses,
    ledger,
    types,
    structs,
    enums,
    constructor,
    diagnostics,
    lines,
    lineByIndex,
    code,
  };
}
