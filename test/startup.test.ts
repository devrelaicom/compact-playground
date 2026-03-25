import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../backend/src/utils.js", () => ({
  isCompilerInstalled: vi.fn(),
}));

vi.mock("../backend/src/config.js", () => ({
  getConfig: vi.fn(() => ({
    compactCliPath: "compact",
    ozContractsPath: "/opt/oz-compact/contracts/src",
  })),
  resetConfig: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";
import { isCompilerInstalled } from "../backend/src/utils.js";
import { validateStartup } from "../backend/src/startup.js";

const mockIsCompilerInstalled = isCompilerInstalled as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

describe("validateStartup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok when all dependencies are available", async () => {
    mockIsCompilerInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(true);

    const result = await validateStartup();

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports error when Compact CLI is not installed", async () => {
    mockIsCompilerInstalled.mockResolvedValue(false);
    mockExistsSync.mockReturnValue(true);

    const result = await validateStartup();

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Compact CLI not found");
    expect(result.errors[0]).toContain("compact");
  });

  it("reports error when OZ contracts path is missing", async () => {
    mockIsCompilerInstalled.mockResolvedValue(true);
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("contracts")) return false;
      return true;
    });

    const result = await validateStartup();

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("OpenZeppelin contracts not found"))).toBe(true);
  });

  it("reports multiple errors when all dependencies are missing", async () => {
    mockIsCompilerInstalled.mockResolvedValue(false);
    mockExistsSync.mockReturnValue(false);

    const result = await validateStartup();

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Compact CLI");
    expect(result.errors[1]).toContain("contracts");
  });
});
