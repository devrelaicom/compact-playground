// backend/src/analysis/types.ts

import type { ExecutableError } from "../types.js";

// ── Source Location ──────────────────────────────────────────────────

export interface SourceLocation {
  line: number; // 1-based
  column: number; // 0-based
  offset: number; // character offset from start of source
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

// ── Parse Diagnostics ────────────────────────────────────────────────

export interface ParseDiagnostic extends ExecutableError {
  location?: SourceLocation;
}

// ── Parsed Declarations ──────────────────────────────────────────────

export interface ParsedParameter {
  name: string;
  type: string;
}

export interface ParsedCircuit {
  name: string;
  isExported: boolean;
  isPure: boolean;
  parameters: ParsedParameter[];
  returnType: string;
  location: SourceLocation;
  body: string;
  bodySpan: SourceSpan;
}

export interface ParsedWitness {
  name: string;
  isExported: boolean;
  parameters: ParsedParameter[];
  returnType: string;
  location: SourceLocation;
}

export interface ParsedLedgerField {
  name: string;
  type: string;
  isExported: boolean;
  isSealed: boolean;
  location: SourceLocation;
}

export interface ParsedTypeAlias {
  name: string;
  definition: string;
  location: SourceLocation;
}

export interface ParsedStruct {
  name: string;
  isExported: boolean;
  fields: string[];
  location: SourceLocation;
}

export interface ParsedEnum {
  name: string;
  isExported: boolean;
  variants: string[];
  location: SourceLocation;
}

export interface ParsedConstructor {
  parameters: ParsedParameter[];
  body: string;
  bodySpan: SourceSpan;
  location: SourceLocation;
}

export interface ParsedSource {
  pragma: string | null;
  pragmaVersion: string | null;
  imports: string[];
  exports: string[];
  circuits: ParsedCircuit[];
  witnesses: ParsedWitness[];
  ledger: ParsedLedgerField[];
  types: ParsedTypeAlias[];
  structs: ParsedStruct[];
  enums: ParsedEnum[];
  constructor: ParsedConstructor | null;
  diagnostics: ParseDiagnostic[];
  lines: string[];
  lineByIndex: number[];
  code: string;
}

// ── Semantic Model ───────────────────────────────────────────────────

export interface CircuitOperations {
  readsLedger: string[]; // ledger field names read
  writesLedger: string[]; // ledger field names written
  usesDisclose: boolean;
  usesCommit: boolean;
  usesHash: boolean;
  usesAssert: boolean;
  usesWitnesses: string[]; // witness names referenced
  ledgerMutations: Array<{
    field: string;
    operation: "insert" | "increment" | "decrement" | "assign";
    location: SourceLocation;
  }>;
}

export interface SemanticCircuit {
  parsed: ParsedCircuit;
  operations: CircuitOperations;
}

export interface SemanticModel {
  source: ParsedSource;
  circuits: SemanticCircuit[];
  unusedWitnesses: string[];
  hasStdLibImport: boolean;
}

// ── Findings ─────────────────────────────────────────────────────────

export type FindingSeverity = "error" | "warning" | "info";

export interface Finding {
  code: string; // machine-readable code e.g. "deprecated-ledger-block"
  severity: FindingSeverity;
  message: string;
  suggestion: string;
  location?: SourceLocation;
}

// ── Recommendations ──────────────────────────────────────────────────

export interface Recommendation {
  message: string;
  priority: "high" | "medium" | "low";
  relatedFindings: string[]; // finding codes that motivated this
}

// ── Circuit Explanation ──────────────────────────────────────────────

export interface CircuitExplanation {
  circuitName: string;
  isPublic: boolean;
  isPure: boolean;
  parameters: ParsedParameter[];
  returnType: string;
  explanation: string;
  operations: string[];
  zkImplications: string[];
  privacyConsiderations: string[];
}

import type { AnalysisError } from "../types.js";
import type { CompilerError } from "../parser.js";

// ── Analysis Response (canonical schema) ─────────────────────────────

export interface AnalysisSummary {
  hasLedger: boolean;
  hasCircuits: boolean;
  hasWitnesses: boolean;
  totalLines: number;
  publicCircuits: number;
  privateCircuits: number;
  publicState: number;
  privateState: number;
}

export interface AnalysisStructure {
  imports: string[];
  exports: string[];
  ledger: Array<{
    name: string;
    type: string;
    isPrivate: boolean;
    location: SourceLocation;
  }>;
  circuits: Array<{
    name: string;
    isPublic: boolean;
    isPure: boolean;
    parameters: ParsedParameter[];
    returnType: string;
    location: SourceLocation;
  }>;
  witnesses: Array<{
    name: string;
    parameters: ParsedParameter[];
    returnType: string;
    location: SourceLocation;
  }>;
  types: Array<{
    name: string;
    definition: string;
    location: SourceLocation;
  }>;
}

export interface CompilationResult {
  success: boolean;
  diagnostics: CompilerError[];
  executionTime?: number;
  compilerVersion?: string;
  requestedVersion?: string;
  languageVersion?: string;
}

export interface CircuitAnalysis {
  name: string;
  structure: {
    isPublic: boolean;
    isPure: boolean;
    parameters: ParsedParameter[];
    returnType: string;
    location: SourceLocation;
  };
  explanation: CircuitExplanation;
  facts: {
    readsPrivateState: boolean;
    revealsPrivateData: boolean;
    commitsData: boolean;
    hashesData: boolean;
    constrainsExecution: boolean;
    mutatesLedger: boolean;
    ledgerMutations: string[];
  };
  findings: Finding[];
}

export interface AnalysisResponse {
  success: boolean;
  errors?: AnalysisError[];
  mode: "fast" | "deep";
  diagnostics: ParseDiagnostic[];
  summary: AnalysisSummary;
  structure: AnalysisStructure;
  facts: {
    hasStdLibImport: boolean;
    unusedWitnesses: string[];
  };
  findings: Finding[];
  recommendations: Recommendation[];
  circuits: CircuitAnalysis[];
  compilations?: CompilationResult[];
}

// ── Request Options ──────────────────────────────────────────────────

export type IncludeSection =
  | "diagnostics"
  | "facts"
  | "findings"
  | "recommendations"
  | "circuits"
  | "compilation";

export interface AnalyzeOptions {
  mode: "fast" | "deep";
  versions?: string[];
  include?: IncludeSection[];
  circuit?: string;
  signal?: AbortSignal;
}
