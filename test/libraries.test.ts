import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listAvailableLibraries, linkLibraries } from "../backend/src/libraries.js";
import { resetConfig } from "../backend/src/config.js";
import { mkdir, writeFile, rm, stat } from "fs/promises";
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

  describe("linkLibraries", () => {
    it("symlinks requested library domains into target dir", async () => {
      const targetDir = join("/tmp", "oz-link-test");
      await mkdir(targetDir, { recursive: true });

      try {
        const linked = await linkLibraries(["access/Ownable"], targetDir);
        expect(linked).toContain("access/Ownable");

        const accessStat = await stat(join(targetDir, "access"));
        expect(accessStat.isDirectory() || accessStat.isSymbolicLink()).toBe(true);
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    });

    it("throws for unknown library path", async () => {
      const targetDir = join("/tmp", "oz-link-test-2");
      await mkdir(targetDir, { recursive: true });

      try {
        await expect(linkLibraries(["nonexistent/Foo"], targetDir)).rejects.toThrow(
          /unknown library domain/i,
        );
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    });

    it("resolves transitive dependencies via cross-domain imports", async () => {
      await mkdir(join(testDir, "security"), { recursive: true });
      await mkdir(join(testDir, "utils"), { recursive: true });
      await writeFile(
        join(testDir, "access", "Ownable.compact"),
        'import "../security/Initializable" prefix Initializable_;\nimport "../utils/Utils" prefix Utils_;',
      );
      await writeFile(join(testDir, "security", "Initializable.compact"), "// mock");
      await writeFile(join(testDir, "utils", "Utils.compact"), "// mock");

      const targetDir = join("/tmp", "oz-link-test-3");
      await mkdir(targetDir, { recursive: true });

      try {
        const linked = await linkLibraries(["access/Ownable"], targetDir);
        expect(linked).toContain("access/Ownable");

        // Transitive deps should be linked via domain directories
        const secStat = await stat(join(targetDir, "security"));
        expect(secStat.isDirectory() || secStat.isSymbolicLink()).toBe(true);
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    });
  });
});
