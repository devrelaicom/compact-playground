import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseVersionString,
  isValidVersion,
  compareVersions,
  resolveVersion,
  resolveRequestedVersion,
} from "../backend/src/version-manager.js";

describe("version-manager", () => {
  describe("parseVersionString", () => {
    it("parses a semver string", () => {
      const v = parseVersionString("0.26.0");
      expect(v).toEqual({ major: 0, minor: 26, patch: 0 });
    });

    it("returns null for invalid version", () => {
      expect(parseVersionString("abc")).toBeNull();
      expect(parseVersionString("")).toBeNull();
    });
  });

  describe("isValidVersion", () => {
    it("accepts valid semver", () => {
      expect(isValidVersion("0.26.0")).toBe(true);
      expect(isValidVersion("1.0.0")).toBe(true);
    });

    it("rejects invalid strings", () => {
      expect(isValidVersion("latest")).toBe(false);
      expect(isValidVersion("abc")).toBe(false);
      expect(isValidVersion("")).toBe(false);
    });
  });

  describe("compareVersions", () => {
    it("compares versions correctly", () => {
      expect(compareVersions("0.26.0", "0.25.0")).toBeGreaterThan(0);
      expect(compareVersions("0.25.0", "0.26.0")).toBeLessThan(0);
      expect(compareVersions("0.26.0", "0.26.0")).toBe(0);
    });
  });

  describe("resolveVersion", () => {
    const installed = ["0.24.0", "0.25.0", "0.26.0"];

    it("resolves 'latest' to highest installed version", () => {
      expect(resolveVersion("latest", installed)).toBe("0.26.0");
    });

    it("resolves exact version if installed", () => {
      expect(resolveVersion("0.25.0", installed)).toBe("0.25.0");
    });

    it("returns null for uninstalled version", () => {
      expect(resolveVersion("0.23.0", installed)).toBeNull();
    });

    it("returns null for empty installed list", () => {
      expect(resolveVersion("latest", [])).toBeNull();
    });
  });

  describe("resolveRequestedVersion", () => {
    it("rejects path traversal strings", async () => {
      await expect(
        resolveRequestedVersion("../../etc/passwd", "")
      ).rejects.toThrow("Invalid version format");
    });

    it("rejects command injection strings", async () => {
      await expect(
        resolveRequestedVersion("1.0.0; rm -rf /", "")
      ).rejects.toThrow("Invalid version format");
    });

    it("rejects empty strings", async () => {
      await expect(
        resolveRequestedVersion("", "")
      ).rejects.toThrow("Invalid version format");
    });

    it("rejects partial versions", async () => {
      await expect(
        resolveRequestedVersion("0.26", "")
      ).rejects.toThrow("Invalid version format");
    });

    it("accepts valid semver strings", async () => {
      const result = await resolveRequestedVersion("0.29.0", "");
      expect(result).toBe("0.29.0");
    });
  });
});
