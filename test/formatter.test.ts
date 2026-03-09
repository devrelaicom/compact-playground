import { describe, it, expect } from "vitest";
import { formatCode, FormatResult } from "../backend/src/formatter.js";

describe("formatter", () => {
  describe("formatCode", () => {
    it("returns formatted code and indicates if changes were made", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      const result = await formatCode(code);

      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
      expect(typeof result.formatted).toBe("string");
    });

    it("returns diff when requested", async () => {
      const code = `export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}`;

      const result = await formatCode(code, { diff: true });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    });

    it("returns unchanged flag when code is already formatted", async () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;

import CompactStandardLibrary;

export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
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
