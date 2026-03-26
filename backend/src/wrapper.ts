/**
 * Code wrapper utilities for Compact snippets
 *
 * Automatically wraps incomplete code snippets with the necessary
 * pragma and imports to make them compilable.
 */

// Default language version range
const DEFAULT_MIN_VERSION = "0.20";
const DEFAULT_MAX_VERSION = "0.21";

/**
 * Checks if the code contains a pragma statement
 */
export function hasPragma(code: string): boolean {
  return /pragma\s+language_version/i.test(code);
}

/**
 * Checks if the code has a CompactStandardLibrary import
 */
export function hasStdLibImport(code: string): boolean {
  return /import\s+CompactStandardLibrary/i.test(code);
}

/**
 * Checks if the code appears to be a complete contract (has pragma or export)
 */
export function isCompleteContract(code: string): boolean {
  return hasPragma(code) || /^\s*export\s+/m.test(code);
}

/**
 * Wraps code with default pragma and imports if needed
 */
export function wrapWithDefaults(code: string, languageVersion?: string): string {
  const trimmedCode = code.trim();

  // If it already has pragma, return as-is
  if (hasPragma(trimmedCode)) {
    return trimmedCode;
  }

  const minVersion = languageVersion || DEFAULT_MIN_VERSION;
  const maxVersion = DEFAULT_MAX_VERSION;

  // Build the wrapper
  const parts: string[] = [];

  // Add pragma
  parts.push(`pragma language_version >= ${minVersion} && <= ${maxVersion};`);
  parts.push("");

  // Add standard library import if not present
  if (!hasStdLibImport(trimmedCode)) {
    parts.push("import CompactStandardLibrary;");
    parts.push("");
  }

  // Add the user's code
  parts.push(trimmedCode);

  return parts.join("\n");
}

/**
 * Detects what type of snippet this is and provides appropriate wrapping
 */
export type SnippetType =
  | "complete" // Full contract with pragma
  | "circuit" // Just a circuit definition
  | "ledger" // Ledger declarations
  | "expression" // A single expression
  | "unknown";

export function detectSnippetType(code: string): SnippetType {
  const trimmed = code.trim();

  if (hasPragma(trimmed)) {
    return "complete";
  }

  if (/^\s*(export\s+)?(circuit|pure\s+circuit)\s+/m.test(trimmed)) {
    return "circuit";
  }

  if (/^\s*(export\s+)?ledger\s+/m.test(trimmed)) {
    return "ledger";
  }

  if (/^\s*(export\s+)?(enum|struct)\s+/m.test(trimmed)) {
    return "ledger"; // Treat type definitions like ledger
  }

  return "unknown";
}

/**
 * Smart wrapper that adds appropriate context based on snippet type
 */
export function smartWrap(
  code: string,
  options: {
    languageVersion?: string;
    addTestCircuit?: boolean;
  } = {}
): string {
  const snippetType = detectSnippetType(code);

  if (snippetType === "complete") {
    return code;
  }

  // For circuits and ledger declarations, just add pragma and imports
  if (snippetType === "circuit" || snippetType === "ledger") {
    return wrapWithDefaults(code, options.languageVersion);
  }

  // For unknown/expression snippets, wrap in a test circuit if requested
  if (options.addTestCircuit && snippetType === "unknown") {
    const minVersion = options.languageVersion || DEFAULT_MIN_VERSION;
    const maxVersion = DEFAULT_MAX_VERSION;

    return `pragma language_version >= ${minVersion} && <= ${maxVersion};

import CompactStandardLibrary;

export circuit test(): [] {
  ${code}
}
`;
  }

  // Default: just add pragma and imports
  return wrapWithDefaults(code, options.languageVersion);
}

/**
 * Extracts the line offset caused by wrapping
 * This is useful for adjusting error line numbers
 */
export function getWrapperLineOffset(originalCode: string): number {
  if (hasPragma(originalCode)) {
    return 0;
  }

  // pragma line + empty line + import line + empty line = 4 lines
  const hasImport = hasStdLibImport(originalCode);
  return hasImport ? 2 : 4;
}
