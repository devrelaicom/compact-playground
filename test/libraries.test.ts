import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listAvailableLibraries } from "../backend/src/libraries.js";
import { resetConfig } from "../backend/src/config.js";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

describe("libraries", () => {
  const testDir = join("/tmp", "oz-test-libs");
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    resetConfig();
    await mkdir(join(testDir, "access"), { recursive: true });
    await mkdir(join(testDir, "token"), { recursive: true });
    await writeFile(join(testDir, "access", "Ownable.compact"), "// mock");
    await writeFile(join(testDir, "token", "FungibleToken.compact"), "// mock");
    process.env.OZ_CONTRACTS_PATH = testDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetConfig();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("listAvailableLibraries", () => {
    it("lists all .compact files grouped by domain", async () => {
      const libs = await listAvailableLibraries();
      expect(libs).toContainEqual({
        name: "Ownable",
        domain: "access",
        path: "access/Ownable",
      });
      expect(libs).toContainEqual({
        name: "FungibleToken",
        domain: "token",
        path: "token/FungibleToken",
      });
    });

    it("returns empty array when OZ path does not exist", async () => {
      process.env.OZ_CONTRACTS_PATH = "/nonexistent/path";
      resetConfig();
      const libs = await listAvailableLibraries();
      expect(libs).toEqual([]);
    });
  });
});
