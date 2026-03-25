import { readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "./config.js";

/** Default age threshold: 1 hour in milliseconds */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

/** Directories matching these prefixes are workspace session dirs eligible for sweeping. */
const SESSION_DIR_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, // UUID (compiler, archive)
  /^fmt-/, // formatter
  /^sim-/, // simulator
];

function isSessionDir(name: string): boolean {
  return SESSION_DIR_PATTERNS.some((pattern) => pattern.test(name));
}

export interface SweepResult {
  swept: number;
  errors: number;
}

/**
 * Scans TEMP_DIR for session directories older than maxAgeMs and removes them.
 * Only targets directories matching known session prefixes (UUID, fmt-, sim-).
 * Skips non-session directories like compact-versions.
 */
export async function sweepStaleTempDirs(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<SweepResult> {
  const config = getConfig();
  const tempDir = config.tempDir;
  const now = Date.now();
  let swept = 0;
  let errors = 0;

  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch {
    // TEMP_DIR doesn't exist yet — nothing to sweep
    return { swept: 0, errors: 0 };
  }

  for (const entry of entries) {
    if (!isSessionDir(entry)) continue;

    const fullPath = join(tempDir, entry);
    try {
      const stats = await stat(fullPath);
      if (!stats.isDirectory()) continue;

      const ageMs = now - stats.mtimeMs;
      if (ageMs > maxAgeMs) {
        await rm(fullPath, { recursive: true, force: true });
        swept++;
      }
    } catch {
      errors++;
    }
  }

  return { swept, errors };
}
