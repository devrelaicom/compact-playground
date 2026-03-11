import { execFileSync } from "child_process";

/**
 * Check if the Compact CLI is available in PATH.
 * Tests that shell out to the CLI should use `describe.skipIf(!HAS_COMPACT_CLI)`
 * so they are skipped in environments where the CLI isn't installed (e.g., CI).
 */
export const HAS_COMPACT_CLI = (() => {
  try {
    execFileSync("compact", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
