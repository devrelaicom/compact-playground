import type { CompilerError } from "./parser.js";

export interface MatrixEntry {
  version: string;
  success: boolean;
  errors?: CompilerError[];
  warnings?: CompilerError[];
  executionTime?: number;
}

export type CompileFn = (
  code: string,
  version: string
) => Promise<MatrixEntry>;

/**
 * Compiles code against multiple versions in parallel and returns the matrix.
 */
export async function buildMatrix(
  code: string,
  versions: string[],
  compileFn: CompileFn
): Promise<MatrixEntry[]> {
  const results = await Promise.allSettled(
    versions.map((version) => compileFn(code, version))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      version: versions[i],
      success: false,
      errors: [{ message: result.reason?.message || "Compilation failed", severity: "error" as const }],
    };
  });
}
