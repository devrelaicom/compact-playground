import { describe, it, expect } from "vitest";
import { parseCompilerErrors, formatErrors, parseCompilerInsights } from "../backend/src/parser.js";

describe("compiler error parser", () => {
  describe("parseCompilerErrors", () => {
    it("returns empty array for empty input", () => {
      expect(parseCompilerErrors("")).toEqual([]);
      expect(parseCompilerErrors("   ")).toEqual([]);
    });

    it("parses exception format errors", () => {
      const output = `Exception: contract.compact line 5 char 12:
  expected first argument of increment to have type Uint<16> but received Uint<64>`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          file: "contract.compact",
          line: 5,
          column: 12,
          severity: "error",
        }),
      );
      expect(errors[0].message).toContain("expected first argument");
    });

    it("parses multiple errors", () => {
      const output = `Exception: contract.compact line 5 char 12:
  first error message
Exception: contract.compact line 10 char 5:
  second error message`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(2);
      expect(errors[0].line).toBe(5);
      expect(errors[1].line).toBe(10);
    });

    it("parses simple error format", () => {
      const output = `Error: Compilation failed`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe("error");
      expect(errors[0].message).toBe("Compilation failed");
    });

    it("parses warning format", () => {
      const output = `Warning: Unused variable`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe("warning");
    });

    it("parses parse error format", () => {
      const output = `parse error: found "{" looking for an identifier`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('found "{"');
    });

    it("handles unbound identifier errors", () => {
      const output = `Exception: contract.compact line 3 char 10:
  unbound identifier "public_key"`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("unbound identifier");
    });

    it("handles type mismatch errors", () => {
      const output = `Exception: contract.compact line 7 char 15:
  expected amount to have type Uint<64> but received Field`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("expected");
      expect(errors[0].message).toContain("Uint<64>");
    });

    it("deduplicates identical errors", () => {
      const output = `Exception: contract.compact line 5 char 12:
  duplicate error
Exception: contract.compact line 5 char 12:
  duplicate error`;

      const errors = parseCompilerErrors(output);

      expect(errors).toHaveLength(1);
    });
  });

  describe("formatErrors", () => {
    it("formats errors with line numbers", () => {
      const errors = [
        {
          line: 5,
          column: 12,
          message: "test error",
          severity: "error" as const,
        },
      ];

      const formatted = formatErrors(errors);

      expect(formatted).toContain("Error at line 5, column 12: test error");
    });

    it("formats errors without line numbers", () => {
      const errors = [
        {
          message: "general error",
          severity: "error" as const,
        },
      ];

      const formatted = formatErrors(errors);

      expect(formatted).toBe("Error: general error");
    });

    it("formats warnings correctly", () => {
      const errors = [
        {
          line: 3,
          message: "unused variable",
          severity: "warning" as const,
        },
      ];

      const formatted = formatErrors(errors);

      expect(formatted).toContain("Warning at line 3: unused variable");
    });

    it("formats multiple errors with newlines", () => {
      const errors = [
        { message: "error 1", severity: "error" as const },
        { message: "error 2", severity: "error" as const },
      ];

      const formatted = formatErrors(errors);

      expect(formatted.split("\n")).toHaveLength(2);
    });
  });

  describe("parseCompilerInsights", () => {
    it("returns null for empty input", () => {
      expect(parseCompilerInsights("")).toBeNull();
      expect(parseCompilerInsights("   ")).toBeNull();
    });

    it("parses circuit names and k-value from compiler output", () => {
      const output = `Compiling contract.compact
circuit "transfer" (k=11, rows=1180)
circuit "approve" (k=8, rows=512)
Compilation complete`;

      const insights = parseCompilerInsights(output);

      expect(insights).not.toBeNull();
      const result = insights as NonNullable<typeof insights>;
      expect(result.circuitCount).toBe(2);
      expect(result.circuits).toHaveLength(2);
      expect(result.circuits[0]).toEqual({
        name: "transfer",
        k: 11,
        rows: 1180,
      });
      expect(result.circuits[1]).toEqual({
        name: "approve",
        k: 8,
        rows: 512,
      });
      expect(result.usesZkProofs).toBe(true);
    });

    it("handles output with no circuit metrics", () => {
      const output = `Compiling contract.compact
Compilation complete`;

      const insights = parseCompilerInsights(output);

      expect(insights).toBeNull();
    });

    it("parses circuit names without k-value (skip-zk mode)", () => {
      const output = `Compiling contract.compact
Compiled circuit "transfer"
Compiled circuit "approve"
Compilation complete`;

      const insights = parseCompilerInsights(output);

      expect(insights).not.toBeNull();
      const result = insights as NonNullable<typeof insights>;
      expect(result.circuitCount).toBe(2);
      expect(result.circuits).toHaveLength(2);
      expect(result.circuits[0]).toEqual({ name: "transfer" });
      expect(result.circuits[1]).toEqual({ name: "approve" });
      expect(result.usesZkProofs).toBe(false);
    });

    it("handles single circuit", () => {
      const output = `circuit "increment" (k=5, rows=200)`;

      const insights = parseCompilerInsights(output);

      expect(insights).not.toBeNull();
      const result = insights as NonNullable<typeof insights>;
      expect(result.circuitCount).toBe(1);
      expect(result.circuits[0].name).toBe("increment");
      expect(result.circuits[0].k).toBe(5);
      expect(result.circuits[0].rows).toBe(200);
    });

    it("handles mixed output with errors interspersed", () => {
      const output = `Warning: unused variable
circuit "transfer" (k=11, rows=1180)
Some other output`;

      const insights = parseCompilerInsights(output);

      expect(insights).not.toBeNull();
      const result = insights as NonNullable<typeof insights>;
      expect(result.circuitCount).toBe(1);
      expect(result.circuits[0].name).toBe("transfer");
    });
  });
});
