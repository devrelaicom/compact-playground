/**
 * Shared types for the Compact Playground backend.
 */

/** Severity levels for errors and warnings from CLI tools. */
export type Severity = "error" | "warning" | "info";

/** Base error shape returned by any external executable (compiler, formatter, etc.). */
export interface ExecutableError {
  message: string;
  severity: Severity;
}

/** Error from the Compact formatter. */
export type FormatterError = ExecutableError;

/** Error from proof analysis. */
export type ProofAnalysisError = ExecutableError;

/** Error from contract diffing. */
export type DiffError = ExecutableError;

/** Error from contract visualization. */
export type VisualizationError = ExecutableError;

/** Error from contract simulation. */
export interface SimulationError extends ExecutableError {
  errorCode?: "CAPACITY_EXCEEDED" | "SESSION_NOT_FOUND" | "CIRCUIT_NOT_FOUND";
}
