import { describe, it, expect } from "vitest";
import { findContractEntry } from "../../backend/src/simulator/oz-factory.js";

describe("oz-factory", () => {
  describe("findContractEntry", () => {
    it("finds contract/index.cjs first", () => {
      const bindings = {
        "contract/index.cjs": "exports.Contract = class {};",
        "contract/index.ts": "export class Contract {}",
      };
      expect(findContractEntry(bindings)).toBe("contract/index.cjs");
    });

    it("finds contract/index.js when no .cjs", () => {
      const bindings = {
        "contract/index.js": "export class Contract {}",
        "contract/index.ts": "export class Contract {}",
      };
      expect(findContractEntry(bindings)).toBe("contract/index.js");
    });

    it("finds contract/index.ts as fallback", () => {
      const bindings = {
        "contract/index.ts": "export class Contract {}",
        "other.ts": "// not a contract",
      };
      expect(findContractEntry(bindings)).toBe("contract/index.ts");
    });

    it("falls back to regex match for Contract export", () => {
      const bindings = {
        "my/custom/path.ts": "export class Contract<P> {}",
      };
      expect(findContractEntry(bindings)).toBe("my/custom/path.ts");
    });

    it("returns null when no entry found", () => {
      const bindings = {
        "utils.ts": "export function helper() {}",
      };
      expect(findContractEntry(bindings)).toBeNull();
    });

    it("returns null for empty bindings", () => {
      expect(findContractEntry({})).toBeNull();
    });
  });
});
