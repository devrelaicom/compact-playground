// backend/src/analysis/tokenizer.ts

/**
 * Token kinds for the Compact language tokenizer.
 *
 * We distinguish only the punctuation/operators that the declaration parser
 * needs (parens, braces, brackets, angles, comma, semicolon, colon, dot,
 * equals, fat-arrow, double-ampersand).  Everything else (arithmetic,
 * comparison, bitwise, logical-or) is lumped into `Other` — just enough
 * to consume the right number of characters so the token stream stays in
 * sync with the source.
 */
export enum TokenKind {
  Ident, // identifiers AND keywords — keywords are checked by value
  Num, // 42, 0.16, 1n
  Str, // "hello" or 'hello' or `hello`
  LParen, // (
  RParen, // )
  LBrace, // {
  RBrace, // }
  LBracket, // [
  RBracket, // ]
  LAngle, // <
  RAngle, // >
  Comma, // ,
  Semi, // ;
  Colon, // :
  Dot, // .
  Eq, // =
  Arrow, // =>
  AmpAmp, // &&
  Other, // ==, !=, ||, <=, >=, <<, >>, +, -, *, /, !, ~, &, |, ^
  EOF,
}

export interface Token {
  kind: TokenKind;
  value: string;
  offset: number; // character offset in source
}

/**
 * Tokenize Compact source code.
 *
 * Comments (line and block) and whitespace are silently consumed — they
 * never appear in the output token stream.  String literals (single,
 * double, and backtick) are preserved as single `Str` tokens with their
 * delimiters included in `value`.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;
  let i = 0;

  function push(kind: TokenKind, value: string, offset: number) {
    tokens.push({ kind, value, offset });
  }

  while (i < len) {
    const ch = source[i];

    // ── Whitespace ──
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // ── Comments ──
    if (ch === "/" && i + 1 < len) {
      if (source[i + 1] === "/") {
        // line comment
        i += 2;
        while (i < len && source[i] !== "\n") i++;
        continue;
      }
      if (source[i + 1] === "*") {
        // block comment
        i += 2;
        while (i < len && !(source[i] === "*" && i + 1 < len && source[i + 1] === "/")) i++;
        if (i < len) i += 2; // skip */
        continue;
      }
    }

    // ── String literals ──
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      const quote = ch;
      i++;
      while (i < len) {
        if (source[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      push(TokenKind.Str, source.slice(start, i), start);
      continue;
    }

    // ── Number literals (including bigint suffix 'n') ──
    if (ch >= "0" && ch <= "9") {
      const start = i;
      while (i < len && ((source[i] >= "0" && source[i] <= "9") || source[i] === ".")) i++;
      if (i < len && source[i] === "n") i++; // bigint suffix
      push(TokenKind.Num, source.slice(start, i), start);
      continue;
    }

    // ── Identifiers / keywords ──
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      while (
        i < len &&
        ((source[i] >= "a" && source[i] <= "z") ||
          (source[i] >= "A" && source[i] <= "Z") ||
          (source[i] >= "0" && source[i] <= "9") ||
          source[i] === "_")
      )
        i++;
      push(TokenKind.Ident, source.slice(start, i), start);
      continue;
    }

    // ── Two-character tokens ──
    const next = i + 1 < len ? source[i + 1] : "";

    if (ch === "=" && next === ">") {
      push(TokenKind.Arrow, "=>", i);
      i += 2;
      continue;
    }
    if (ch === "&" && next === "&") {
      push(TokenKind.AmpAmp, "&&", i);
      i += 2;
      continue;
    }
    // Consume two-char operators as Other to stay in sync.
    // Deliberately exclude <, > combinations (<=, >=, <<, >>) so that
    // < and > are always individual tokens — this makes nested generics
    // like Map<Bytes<32>, Uint<64>> parse correctly.
    if (
      (ch === "=" && next === "=") ||
      (ch === "!" && next === "=") ||
      (ch === "|" && next === "|")
    ) {
      push(TokenKind.Other, source.slice(i, i + 2), i);
      i += 2;
      continue;
    }

    // ── Single-character tokens ──
    const start = i;
    i++;
    switch (ch) {
      case "(":
        push(TokenKind.LParen, ch, start);
        break;
      case ")":
        push(TokenKind.RParen, ch, start);
        break;
      case "{":
        push(TokenKind.LBrace, ch, start);
        break;
      case "}":
        push(TokenKind.RBrace, ch, start);
        break;
      case "[":
        push(TokenKind.LBracket, ch, start);
        break;
      case "]":
        push(TokenKind.RBracket, ch, start);
        break;
      case "<":
        push(TokenKind.LAngle, ch, start);
        break;
      case ">":
        push(TokenKind.RAngle, ch, start);
        break;
      case ",":
        push(TokenKind.Comma, ch, start);
        break;
      case ";":
        push(TokenKind.Semi, ch, start);
        break;
      case ":":
        push(TokenKind.Colon, ch, start);
        break;
      case ".":
        push(TokenKind.Dot, ch, start);
        break;
      case "=":
        push(TokenKind.Eq, ch, start);
        break;
      default:
        // +, -, *, /, !, ~, &, |, ^, or any other single character
        push(TokenKind.Other, ch, start);
        break;
    }
  }

  push(TokenKind.EOF, "", i);
  return tokens;
}
