import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prepareVersionDir, resetPreparedVersionDirs } from "../backend/src/version-manager.js";
import { resetConfig } from "../backend/src/config.js";

// Track spawn calls via a counter that the mock factory closes over.
// vi.mock is file-scoped in vitest's forks pool, so this does not leak
// into other test files (formatter, compiler) that spawn real processes.
let spawnCallCount = 0;

vi.mock("child_process", () => {
  const { EventEmitter } = require("events");
  return {
    spawn: vi.fn(() => {
      spawnCallCount++;
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();

      // Simulate async completion after 50ms
      setTimeout(() => proc.emit("close", 0), 50);

      return proc;
    }),
  };
});

describe("prepareVersionDir race condition", () => {
  beforeEach(() => {
    spawnCallCount = 0;
    resetPreparedVersionDirs();
    resetConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates concurrent installs of the same version", async () => {
    // Launch 5 concurrent prepareVersionDir calls for the same version
    const promises = Array.from({ length: 5 }, () => prepareVersionDir("0.29.0"));

    const results = await Promise.all(promises);

    // All should resolve to the same directory
    const dirs = new Set(results);
    expect(dirs.size).toBe(1);

    // spawn should only have been called once
    expect(spawnCallCount).toBe(1);
  });

  it("allows parallel installs of different versions", async () => {
    const [dir1, dir2] = await Promise.all([
      prepareVersionDir("0.29.0"),
      prepareVersionDir("0.28.0"),
    ]);

    expect(dir1).not.toBe(dir2);
    expect(spawnCallCount).toBe(2);
  });

  it("uses cache for already-ensured versions", async () => {
    await prepareVersionDir("0.29.0");
    expect(spawnCallCount).toBe(1);

    // Second call should be cached
    await prepareVersionDir("0.29.0");
    expect(spawnCallCount).toBe(1);
  });
});
