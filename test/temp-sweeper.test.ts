import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, utimesSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../backend/src/config.js", () => ({
  getConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

import { getConfig } from "../backend/src/config.js";
import { sweepStaleTempDirs } from "../backend/src/temp-sweeper.js";

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;

describe("sweepStaleTempDirs", () => {
  let testTempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    testTempDir = mkdtempSync(join(tmpdir(), "sweep-test-"));
    mockGetConfig.mockReturnValue({ tempDir: testTempDir });
  });

  afterEach(() => {
    rmSync(testTempDir, { recursive: true, force: true });
  });

  function createDir(name: string, ageMs: number = 0): string {
    const dir = join(testTempDir, name);
    mkdirSync(dir, { recursive: true });
    if (ageMs > 0) {
      const past = new Date(Date.now() - ageMs);
      utimesSync(dir, past, past);
    }
    return dir;
  }

  it("removes old UUID session dirs (compiler/archive pattern)", async () => {
    const oldDir = createDir("a1b2c3d4-e5f6-7890-abcd-ef1234567890", 2 * 60 * 60 * 1000);

    const result = await sweepStaleTempDirs(60 * 60 * 1000); // 1 hour threshold

    expect(result.swept).toBe(1);
    expect(result.errors).toBe(0);
    expect(existsSync(oldDir)).toBe(false);
  });

  it("removes old fmt- dirs (formatter pattern)", async () => {
    const oldDir = createDir("fmt-a1b2c3d4-e5f6-7890-abcd-ef1234567890", 2 * 60 * 60 * 1000);

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(1);
    expect(existsSync(oldDir)).toBe(false);
  });

  it("removes old sim- dirs (simulator pattern)", async () => {
    const oldDir = createDir("sim-a1b2c3d4-e5f6-7890-abcd-ef1234567890", 2 * 60 * 60 * 1000);

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(1);
    expect(existsSync(oldDir)).toBe(false);
  });

  it("does NOT remove recent session dirs", async () => {
    const recentDir = createDir("a1b2c3d4-e5f6-7890-abcd-ef1234567890"); // just created

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(0);
    expect(existsSync(recentDir)).toBe(true);
  });

  it("does NOT remove non-session dirs like compact-versions", async () => {
    const versionsDir = createDir("compact-versions", 2 * 60 * 60 * 1000);

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(0);
    expect(existsSync(versionsDir)).toBe(true);
  });

  it("does NOT remove arbitrary named dirs", async () => {
    const otherDir = createDir("some-other-thing", 2 * 60 * 60 * 1000);

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(0);
    expect(existsSync(otherDir)).toBe(true);
  });

  it("skips files (not directories)", async () => {
    const filePath = join(testTempDir, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    writeFileSync(filePath, "not a dir");
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(filePath, past, past);

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(0);
  });

  it("returns zeros when TEMP_DIR does not exist", async () => {
    mockGetConfig.mockReturnValue({ tempDir: "/nonexistent/path/that/does/not/exist" });

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("sweeps multiple old dirs in a single pass", async () => {
    createDir("a1b2c3d4-e5f6-7890-abcd-ef1234567890", 2 * 60 * 60 * 1000);
    createDir("fmt-b2c3d4e5-f6a7-8901-bcde-f12345678901", 2 * 60 * 60 * 1000);
    createDir("sim-c3d4e5f6-a7b8-9012-cdef-123456789012", 2 * 60 * 60 * 1000);
    createDir("compact-versions", 2 * 60 * 60 * 1000); // should NOT be swept

    const result = await sweepStaleTempDirs(60 * 60 * 1000);

    expect(result.swept).toBe(3);
    expect(result.errors).toBe(0);
  });
});
