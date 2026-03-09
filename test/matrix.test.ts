import { describe, it, expect } from "vitest";
import { buildMatrix, type MatrixEntry } from "../backend/src/matrix.js";

describe("matrix", () => {
  describe("buildMatrix", () => {
    it("returns a result for each version", async () => {
      const mockCompile = async (code: string, version: string) => ({
        version,
        success: true,
        errors: undefined,
        warnings: undefined,
        executionTime: 100,
      });

      const versions = ["0.25.0", "0.26.0"];
      const results = await buildMatrix(
        "export circuit test(): [] {}",
        versions,
        mockCompile
      );

      expect(results).toHaveLength(2);
      expect(results[0].version).toBe("0.25.0");
      expect(results[1].version).toBe("0.26.0");
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("handles compile failures per version", async () => {
      const mockCompile = async (code: string, version: string) => ({
        version,
        success: version !== "0.25.0",
        errors: version === "0.25.0" ? [{ message: "unsupported", severity: "error" as const }] : undefined,
        warnings: undefined,
        executionTime: 100,
      });

      const results = await buildMatrix(
        "code",
        ["0.25.0", "0.26.0"],
        mockCompile
      );

      expect(results[0].success).toBe(false);
      expect(results[0].errors).toBeDefined();
      expect(results[1].success).toBe(true);
    });

    it("handles rejected promises gracefully", async () => {
      const mockCompile = async (code: string, version: string) => {
        if (version === "0.24.0") throw new Error("Compiler crashed");
        return { version, success: true, executionTime: 50 };
      };

      const results = await buildMatrix(
        "code",
        ["0.24.0", "0.26.0"],
        mockCompile
      );

      expect(results[0].success).toBe(false);
      expect(results[0].errors![0].message).toBe("Compiler crashed");
      expect(results[1].success).toBe(true);
    });
  });
});
