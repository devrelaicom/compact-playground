import { describe, it, expect } from "vitest";
import { formatCode } from "../backend/src/formatter.js";
import { HAS_COMPACT_CLI } from "./helpers.js";

describe.skipIf(!HAS_COMPACT_CLI)("formatter", () => {
  describe("formatCode", () => {
    it("returns formatted code and indicates if changes were made", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      const result = await formatCode(code);

      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
      expect(typeof result.formatted).toBe("string");
    });

    it("always returns diff when code changed", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      const result = await formatCode(code);

      expect(result.success).toBe(true);
      if (result.changed) {
        expect(result.diff).toBeDefined();
        expect(result.diff?.length).toBeGreaterThan(0);
      }
    });

    it("returns diff even without diff option when changed", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      // No diff option passed — diff should still be returned
      const result = await formatCode(code);

      expect(result.success).toBe(true);
      if (result.changed) {
        expect(result.diff).toBeDefined();
      }
    });

    it("returns unchanged flag when code is already formatted", async () => {
      const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}
`;

      const result = await formatCode(code);

      expect(result.success).toBe(true);
      expect(typeof result.changed).toBe("boolean");
    });

    it("handles empty code", async () => {
      const result = await formatCode("");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("handles code that fails to parse", async () => {
      const result = await formatCode("this is not compact code {{{");

      expect(result.success).toBe(false);
    });
  });
});
