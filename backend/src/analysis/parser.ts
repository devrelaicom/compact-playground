// backend/src/analysis/parser.ts
import { tokenize, TokenKind } from "./tokenizer.js";
import type { Token } from "./tokenizer.js";
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

// ── Helpers (kept exported for downstream consumers) ─────────────────

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
 * Kept for backward compatibility.
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
 * Extract the contents of a balanced brace block starting at `startIndex`.
 * Kept for backward compatibility.
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

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

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

// ── Token Stream ─────────────────────────────────────────────────────

class TokenStream {
  private pos = 0;
  constructor(
    private tokens: Token[],
    public readonly source: string,
  ) {}

  peek(ahead = 0): Token {
    const idx = this.pos + ahead;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }

  next(): Token {
    const tok = this.peek();
    if (tok.kind !== TokenKind.EOF) this.pos++;
    return tok;
  }

  at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  atWord(value: string): boolean {
    const tok = this.peek();
    return tok.kind === TokenKind.Ident && tok.value === value;
  }

  eat(kind: TokenKind): Token | null {
    if (this.at(kind)) return this.next();
    return null;
  }

  eatWord(value: string): Token | null {
    if (this.atWord(value)) return this.next();
    return null;
  }

  /** Raw source text between two character offsets, trimmed. */
  slice(from: number, to: number): string {
    return this.source.slice(from, to).trim();
  }

  /** End offset of a token (offset + value.length). */
  tokenEnd(tok: Token): number {
    return tok.offset + tok.value.length;
  }

  /** Offset right after the last non-EOF token consumed (or 0 if none). */
  lastConsumedEnd(): number {
    if (this.pos === 0) return 0;
    const last = this.tokens[this.pos - 1];
    return last.offset + last.value.length;
  }

  /**
   * Skip tokens until we reach the opening brace, then extract the balanced
   * body.  Returns the raw body string (between { and }) and source offsets.
   */
  extractBody(): {
    bodyStart: number;
    body: string;
    bodyEnd: number;
  } | null {
    while (!this.at(TokenKind.EOF) && !this.at(TokenKind.LBrace)) {
      this.next();
    }
    if (!this.at(TokenKind.LBrace)) return null;

    const openBrace = this.next(); // consume {
    const bodyStart = openBrace.offset + 1;
    let depth = 1;

    while (!this.at(TokenKind.EOF) && depth > 0) {
      const tok = this.next();
      if (tok.kind === TokenKind.LBrace) depth++;
      if (tok.kind === TokenKind.RBrace) depth--;
    }

    // The last consumed token is the closing }
    const closingBrace = this.tokens[this.pos - 1];
    const bodyEnd = closingBrace.offset;
    return {
      bodyStart,
      body: this.source.slice(bodyStart, bodyEnd),
      bodyEnd,
    };
  }
}

// ── Parameter Parsing ────────────────────────────────────────────────

function parseParamList(ts: TokenStream): ParsedParameter[] {
  if (!ts.eat(TokenKind.LParen)) return [];
  if (ts.at(TokenKind.RParen)) {
    ts.next();
    return [];
  }

  const params: ParsedParameter[] = [];

  while (!ts.at(TokenKind.EOF) && !ts.at(TokenKind.RParen)) {
    // Name
    const nameTok = ts.next();
    const name = nameTok.value;

    // Expect :
    if (!ts.eat(TokenKind.Colon)) {
      // Malformed — just capture what we have
      params.push({ name, type: "unknown" });
      // Skip to , or )
      while (!ts.at(TokenKind.EOF) && !ts.at(TokenKind.Comma) && !ts.at(TokenKind.RParen))
        ts.next();
      ts.eat(TokenKind.Comma);
      continue;
    }

    // Collect type: read tokens until , or ) at angle depth 0
    const typeStartOffset = ts.peek().offset;
    let angleDepth = 0;
    while (!ts.at(TokenKind.EOF)) {
      if (angleDepth === 0 && (ts.at(TokenKind.Comma) || ts.at(TokenKind.RParen))) break;
      const tok = ts.next();
      if (tok.kind === TokenKind.LAngle) angleDepth++;
      if (tok.kind === TokenKind.RAngle) angleDepth = Math.max(0, angleDepth - 1);
    }
    const typeEndOffset = ts.peek().offset;
    const type = ts.slice(typeStartOffset, typeEndOffset);

    params.push({ name, type });
    ts.eat(TokenKind.Comma);
  }

  ts.eat(TokenKind.RParen);
  return params;
}

/**
 * Collect tokens as a type string until a stop kind is encountered at
 * angle-bracket depth 0.  Does not consume the stop token.
 */
function collectType(ts: TokenStream, ...stopKinds: TokenKind[]): string {
  const startOffset = ts.peek().offset;
  let angleDepth = 0;
  while (!ts.at(TokenKind.EOF)) {
    if (angleDepth === 0 && stopKinds.some((k) => ts.at(k))) break;
    const tok = ts.next();
    if (tok.kind === TokenKind.LAngle) angleDepth++;
    if (tok.kind === TokenKind.RAngle) angleDepth = Math.max(0, angleDepth - 1);
  }
  return ts.slice(startOffset, ts.peek().offset);
}

// ── Main Parser ──────────────────────────────────────────────────────

export function parseSource(code: string): ParsedSource {
  const tokens = tokenize(code);
  const ts = new TokenStream(tokens, code);
  const lineByIndex = buildLineByIndex(code);
  const lines = code.split("\n");
  const diagnostics: ParseDiagnostic[] = [];

  let pragma: string | null = null;
  let pragmaVersion: string | null = null;
  const imports: string[] = [];
  const circuits: ParsedCircuit[] = [];
  const witnesses: ParsedWitness[] = [];
  const ledger: ParsedLedgerField[] = [];
  const types: ParsedTypeAlias[] = [];
  const structs: ParsedStruct[] = [];
  const enums: ParsedEnum[] = [];
  let constructor: ParsedConstructor | null = null;

  function loc(offset: number): SourceLocation {
    return locationAt(code, offset, lineByIndex);
  }

  // ── Declaration parsers ──

  function parsePragma() {
    ts.next(); // consume 'pragma'
    ts.eatWord("language_version");
    // Collect everything until ;
    const pragmaStart = ts.peek().offset;
    while (!ts.at(TokenKind.EOF) && !ts.at(TokenKind.Semi)) ts.next();
    const pragmaEnd = ts.peek().offset;
    ts.eat(TokenKind.Semi);

    pragma = ts.slice(pragmaStart, pragmaEnd);
    const versionMatch = pragma.match(/([\d.]+)/);
    pragmaVersion = versionMatch?.[1] ?? null;
  }

  function parseImport() {
    ts.next(); // consume 'import'
    // Simple import: import Identifier;
    // Prefix import: import "path" prefix Identifier_;  OR  import Ident prefix Ident_;
    if (ts.at(TokenKind.Ident)) {
      imports.push(ts.next().value);
    }
    // Skip to semicolon (handles prefix imports and any other forms)
    while (!ts.at(TokenKind.EOF) && !ts.at(TokenKind.Semi)) ts.next();
    ts.eat(TokenKind.Semi);
  }

  function parseCircuit(isExported: boolean, isPure: boolean, startOffset: number) {
    ts.next(); // consume 'circuit'
    const nameTok = ts.next(); // circuit name
    const name = nameTok.value;
    const circuitLoc = loc(startOffset);

    // Parameters
    const parameters = parseParamList(ts);

    // Return type (optional : Type before {)
    let returnType = "[]";
    if (ts.at(TokenKind.Colon)) {
      ts.next();
      returnType = collectType(ts, TokenKind.LBrace, TokenKind.Semi);
    }

    // Body
    let body = "";
    let bodySpan: SourceSpan = { start: circuitLoc, end: circuitLoc };
    const bodyResult = ts.extractBody();
    if (bodyResult) {
      body = bodyResult.body;
      bodySpan = {
        start: loc(bodyResult.bodyStart),
        end: loc(bodyResult.bodyEnd),
      };
    }

    circuits.push({
      name,
      isExported,
      isPure,
      parameters,
      returnType,
      location: circuitLoc,
      body,
      bodySpan,
    });
  }

  function parseWitness(isExported: boolean, startOffset: number) {
    ts.next(); // consume 'witness'
    const nameTok = ts.next(); // witness name
    const name = nameTok.value;
    const witnessLoc = loc(startOffset);

    ts.eat(TokenKind.Colon);

    // Witness type: either (Params) => ReturnType  or  just a type
    let parameters: ParsedParameter[] = [];
    let returnType: string;

    if (ts.at(TokenKind.LParen)) {
      // Function witness type: (Params) => ReturnType
      parameters = parseParamList(ts);
      ts.eat(TokenKind.Arrow); // =>
      returnType = collectType(ts, TokenKind.Semi);
    } else {
      // Non-function witness type
      returnType = collectType(ts, TokenKind.Semi);
    }
    ts.eat(TokenKind.Semi);

    witnesses.push({
      name,
      isExported,
      parameters,
      returnType,
      location: witnessLoc,
    });
  }

  function parseLedger(isExported: boolean, isSealed: boolean, startOffset: number) {
    ts.next(); // consume 'ledger'
    const nameTok = ts.next(); // field name
    const name = nameTok.value;
    const fieldLoc = loc(startOffset);

    ts.eat(TokenKind.Colon);
    const type = collectType(ts, TokenKind.Semi);
    ts.eat(TokenKind.Semi);

    ledger.push({
      name,
      type,
      isExported,
      isSealed,
      location: fieldLoc,
    });
  }

  function parseTypeAlias(startOffset: number) {
    ts.next(); // consume 'type'
    const nameTok = ts.next(); // type name
    const name = nameTok.value;
    const typeLoc = loc(startOffset);

    ts.eat(TokenKind.Eq); // =
    const definition = collectType(ts, TokenKind.Semi);
    ts.eat(TokenKind.Semi);

    types.push({ name, definition, location: typeLoc });
  }

  function parseStruct(isExported: boolean, startOffset: number) {
    ts.next(); // consume 'struct'
    const nameTok = ts.next();
    const name = nameTok.value;
    const structLoc = loc(startOffset);

    // Extract body and split fields by comma
    const bodyResult = ts.extractBody();
    const fields = bodyResult
      ? bodyResult.body
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f)
      : [];

    structs.push({ name, isExported, fields, location: structLoc });
  }

  function parseEnum(isExported: boolean, startOffset: number) {
    ts.next(); // consume 'enum'
    const nameTok = ts.next();
    const name = nameTok.value;
    const enumLoc = loc(startOffset);

    // Extract body and split variants by comma
    const bodyResult = ts.extractBody();
    const variants = bodyResult
      ? bodyResult.body
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v)
      : [];

    enums.push({ name, isExported, variants, location: enumLoc });
  }

  function parseConstructorDecl(startOffset: number) {
    ts.next(); // consume 'constructor'
    const ctorLoc = loc(startOffset);

    // Optional parameter list
    let parameters: ParsedParameter[] = [];
    if (ts.at(TokenKind.LParen)) {
      parameters = parseParamList(ts);
    }

    // Body
    let body = "";
    let bodySpan: SourceSpan = { start: ctorLoc, end: ctorLoc };
    const bodyResult = ts.extractBody();
    if (bodyResult) {
      body = bodyResult.body;
      bodySpan = {
        start: loc(bodyResult.bodyStart),
        end: loc(bodyResult.bodyEnd),
      };
    }

    constructor = { parameters, body, bodySpan, location: ctorLoc };
  }

  // ── Main dispatch loop ──

  while (!ts.at(TokenKind.EOF)) {
    const tok = ts.peek();

    // Only dispatch on identifiers (keywords are Ident tokens)
    if (tok.kind !== TokenKind.Ident) {
      ts.next();
      continue;
    }

    // Non-modified declarations
    if (tok.value === "pragma") {
      parsePragma();
      continue;
    }
    if (tok.value === "import") {
      parseImport();
      continue;
    }
    if (tok.value === "constructor") {
      parseConstructorDecl(tok.offset);
      continue;
    }

    // Declarations that may have modifiers
    const startOffset = tok.offset;
    let isExported = false;
    let isSealed = false;
    let isPure = false;

    if (ts.atWord("export")) {
      isExported = true;
      ts.next();
    }
    if (ts.atWord("sealed")) {
      isSealed = true;
      ts.next();
    }
    if (ts.atWord("pure")) {
      isPure = true;
      ts.next();
    }

    if (ts.atWord("circuit")) {
      parseCircuit(isExported, isPure, startOffset);
      continue;
    }
    if (ts.atWord("ledger")) {
      parseLedger(isExported, isSealed, startOffset);
      continue;
    }
    if (ts.atWord("witness")) {
      parseWitness(isExported, startOffset);
      continue;
    }
    if (ts.atWord("struct")) {
      parseStruct(isExported, startOffset);
      continue;
    }
    if (ts.atWord("enum")) {
      parseEnum(isExported, startOffset);
      continue;
    }
    if (ts.atWord("type")) {
      parseTypeAlias(startOffset);
      continue;
    }

    // Unknown identifier — skip
    ts.next();
  }

  // ── Collect exports ──
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
    exports.push(t.name); // type aliases are always visible
  }
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
