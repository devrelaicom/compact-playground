import { describe, it, expect } from "vitest";
import {
  hasPragma,
  hasStdLibImport,
  wrapWithDefaults,
  detectSnippetType,
  smartWrap,
  getWrapperLineOffset,
} from "../backend/src/wrapper.js";

describe("wrapper utilities", () => {
  describe("hasPragma", () => {
    it("returns true when pragma is present", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;
import CompactStandardLibrary;`;
      expect(hasPragma(code)).toBe(true);
    });

    it("returns false when pragma is missing", () => {
      const code = `export circuit add(): [] {
  return;
}`;
      expect(hasPragma(code)).toBe(false);
    });

    it("handles case-insensitive pragma", () => {
      const code = `PRAGMA language_version >= 0.16 && <= 0.18;`;
      expect(hasPragma(code)).toBe(true);
    });
  });

  describe("hasStdLibImport", () => {
    it("returns true when stdlib import is present", () => {
      const code = `import CompactStandardLibrary;`;
      expect(hasStdLibImport(code)).toBe(true);
    });

    it("returns false when stdlib import is missing", () => {
      const code = `export ledger counter: Counter;`;
      expect(hasStdLibImport(code)).toBe(false);
    });
  });

  describe("wrapWithDefaults", () => {
    it("wraps code without pragma", () => {
      const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
      const wrapped = wrapWithDefaults(code);

      expect(wrapped).toContain("pragma language_version >= 0.16 && <= 0.21;");
      expect(wrapped).toContain("import CompactStandardLibrary;");
      expect(wrapped).toContain(code);
    });

    it("does not wrap code that already has pragma", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;
import CompactStandardLibrary;
export ledger counter: Counter;`;

      const wrapped = wrapWithDefaults(code);
      expect(wrapped).toBe(code);
    });

    it("does not add duplicate stdlib import", () => {
      const code = `import CompactStandardLibrary;
export ledger counter: Counter;`;

      const wrapped = wrapWithDefaults(code);
      const importCount = (
        wrapped.match(/import CompactStandardLibrary/g) || []
      ).length;
      expect(importCount).toBe(1);
    });

    it("uses custom language version when provided", () => {
      const code = `export ledger counter: Counter;`;
      const wrapped = wrapWithDefaults(code, "0.17");

      expect(wrapped).toContain("pragma language_version >= 0.17 && <= 0.21;");
    });
  });

  describe("detectSnippetType", () => {
    it("detects complete contracts", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;
import CompactStandardLibrary;`;
      expect(detectSnippetType(code)).toBe("complete");
    });

    it("detects circuit definitions", () => {
      const code = `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`;
      expect(detectSnippetType(code)).toBe("circuit");
    });

    it("detects pure circuit definitions", () => {
      const code = `pure circuit helper(x: Field): Field {
  return x;
}`;
      expect(detectSnippetType(code)).toBe("circuit");
    });

    it("detects ledger declarations", () => {
      const code = `export ledger counter: Counter;`;
      expect(detectSnippetType(code)).toBe("ledger");
    });

    it("detects enum definitions as ledger type", () => {
      const code = `export enum GameState { waiting, playing, finished }`;
      expect(detectSnippetType(code)).toBe("ledger");
    });

    it("detects struct definitions as ledger type", () => {
      const code = `export struct Player {
  name: Bytes<32>,
  score: Uint<64>,
}`;
      expect(detectSnippetType(code)).toBe("ledger");
    });

    it("returns unknown for other snippets", () => {
      const code = `const x = 42;`;
      expect(detectSnippetType(code)).toBe("unknown");
    });
  });

  describe("smartWrap", () => {
    it("does not wrap complete contracts", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;
import CompactStandardLibrary;
export ledger counter: Counter;`;

      const wrapped = smartWrap(code);
      expect(wrapped).toBe(code);
    });

    it("wraps circuit definitions with pragma and imports", () => {
      const code = `export circuit increment(): [] {
  counter.increment(1);
}`;
      const wrapped = smartWrap(code);

      expect(wrapped).toContain("pragma");
      expect(wrapped).toContain("import CompactStandardLibrary");
      expect(wrapped).toContain(code);
    });

    it("can wrap expressions in test circuit when requested", () => {
      const code = `const x = 42;`;
      const wrapped = smartWrap(code, { addTestCircuit: true });

      expect(wrapped).toContain("export circuit test()");
      expect(wrapped).toContain(code);
    });
  });

  describe("getWrapperLineOffset", () => {
    it("returns 0 for code with pragma", () => {
      const code = `pragma language_version >= 0.16 && <= 0.18;`;
      expect(getWrapperLineOffset(code)).toBe(0);
    });

    it("returns 4 for code without pragma or stdlib import", () => {
      const code = `export circuit add(): [] {}`;
      expect(getWrapperLineOffset(code)).toBe(4);
    });

    it("returns 2 for code with stdlib import but no pragma", () => {
      const code = `import CompactStandardLibrary;
export circuit add(): [] {}`;
      expect(getWrapperLineOffset(code)).toBe(2);
    });
  });
});
