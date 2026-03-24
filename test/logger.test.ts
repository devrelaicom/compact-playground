import { describe, it, expect } from "vitest";
import { safeErrorMessage } from "../backend/src/logger.js";

describe("safeErrorMessage", () => {
  it("extracts class name and message from Error", () => {
    const result = safeErrorMessage(new Error("something went wrong"));
    expect(result).toBe("Error: something went wrong");
  });

  it("extracts class name from custom error types", () => {
    class CompilerError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CompilerError";
      }
    }
    const result = safeErrorMessage(new CompilerError("timeout exceeded"));
    expect(result).toBe("CompilerError: timeout exceeded");
  });

  it("returns 'Unknown error' for non-Error values", () => {
    expect(safeErrorMessage("string error")).toBe("Unknown error");
    expect(safeErrorMessage(42)).toBe("Unknown error");
    expect(safeErrorMessage(null)).toBe("Unknown error");
    expect(safeErrorMessage(undefined)).toBe("Unknown error");
  });

  it("does not include stack traces", () => {
    const error = new Error("test");
    error.stack = "Error: test\n    at Object.<anonymous> (file.ts:1:1)\n    sensitive code here";
    const result = safeErrorMessage(error);
    expect(result).not.toContain("sensitive");
    expect(result).not.toContain("stack");
    expect(result).toBe("Error: test");
  });
});
