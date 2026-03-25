import { existsSync } from "node:fs";
import { getConfig } from "./config.js";
import { isCompilerInstalled } from "./utils.js";

export interface StartupCheckResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates that critical runtime dependencies are available before the
 * server starts accepting traffic. Returns a result indicating success
 * or failure with descriptive error messages.
 */
export async function validateStartup(): Promise<StartupCheckResult> {
  const config = getConfig();
  const errors: string[] = [];

  // Check Compact CLI availability
  const cliAvailable = await isCompilerInstalled();
  if (!cliAvailable) {
    errors.push(
      `Compact CLI not found at "${config.compactCliPath}". ` +
        "Ensure the Compact CLI is installed and COMPACT_CLI_PATH is set correctly.",
    );
  }

  // Check OZ contracts path
  if (!existsSync(config.ozContractsPath)) {
    errors.push(
      `OpenZeppelin contracts not found at "${config.ozContractsPath}". ` +
        "Set OZ_CONTRACTS_PATH to the correct location.",
    );
  }

  return { ok: errors.length === 0, errors };
}
