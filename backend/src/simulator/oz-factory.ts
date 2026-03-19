import { existsSync } from "fs";
import { mkdir, writeFile, symlink, rm } from "fs/promises";
import { join, dirname } from "path";
import { pathToFileURL } from "url";
import { getConfig } from "../config.js";
import type { SimulatorHandle } from "./types.js";

export type { SimulatorHandle };

/* ------------------------------------------------------------------ */
/*  Types for dynamically-imported modules                            */
/* ------------------------------------------------------------------ */

/** Shape of the contract module produced by the Compact compiler. */
interface ContractModule {
  Contract?: new (witnesses: unknown) => unknown;
  ledger?: (state: unknown) => Record<string, unknown>;
  default?: {
    Contract?: new (witnesses: unknown) => unknown;
    ledger?: (state: unknown) => Record<string, unknown>;
  };
}

/** A circuit callable bag: name -> function. */
interface CircuitBag {
  [name: string]: (...args: unknown[]) => unknown;
}

/** Shape of an instantiated OZ simulator. */
interface OzSimInstance {
  circuits: { pure: CircuitBag; impure: CircuitBag };
  getPublicState(): Record<string, unknown> | null;
  getPrivateState(): unknown;
  setPersistentCaller(coinPK: string): void;
  resetCaller(): void;
}

/** Factory function returned by the OZ simulator package. */
type CreateSimulatorFn = (config: {
  contractFactory: (witnesses: unknown) => unknown;
  defaultPrivateState: () => null;
  contractArgs: () => unknown[];
  ledgerExtractor: (state: unknown) => Record<string, unknown>;
  witnessesFactory: () => Record<string, never>;
}) => new (args: unknown[], opts: { coinPK: string }) => OzSimInstance;

/** Shape of the OZ simulator package. */
interface OzSimulatorModule {
  createSimulator?: CreateSimulatorFn;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

/**
 * Creates an OZ contract simulator from compiled TypeScript bindings.
 *
 * Pipeline:
 *   bindings (TS/JS source strings) -> temp directory -> dynamic import -> OZ simulator instance
 */
export async function createContractSimulator(
  bindings: Record<string, string>,
  sessionDir: string,
): Promise<SimulatorHandle> {
  const config = getConfig();

  // Write bindings to temp directory
  for (const [filename, content] of Object.entries(bindings)) {
    const filePath = join(sessionDir, filename);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  }

  // Symlink node_modules so contract imports can resolve
  // (e.g., @midnight-ntwrk/compact-runtime)
  const nodeModulesDir = resolveNodeModules(config.ozSimulatorPath);
  try {
    await symlink(nodeModulesDir, join(sessionDir, "node_modules"));
  } catch {
    // Symlink may already exist
  }

  // Find and import the contract entry point
  const entryFile = findContractEntry(bindings);
  if (!entryFile) {
    throw new Error("No contract entry point found in compiled bindings");
  }

  const entryUrl = pathToFileURL(join(sessionDir, entryFile)).href;
  const contractModule = (await import(entryUrl)) as ContractModule;

  const Contract = contractModule.Contract ?? contractModule.default?.Contract;
  const ledger = contractModule.ledger ?? contractModule.default?.ledger;

  if (!Contract) {
    throw new Error("Compiled bindings do not export a Contract class");
  }

  // Import OZ simulator
  const simEntryUrl = resolveOzSimulatorEntry(config.ozSimulatorPath);
  const ozModule = (await import(simEntryUrl)) as OzSimulatorModule;
  const { createSimulator } = ozModule;

  if (!createSimulator) {
    throw new Error(
      `OZ simulator not found at ${config.ozSimulatorPath}. ` +
        "Ensure the simulator is installed and built.",
    );
  }

  // Create simulator class with contract configuration
  const SimClass = createSimulator({
    contractFactory: (witnesses: unknown) => new Contract(witnesses),
    defaultPrivateState: () => null,
    contractArgs: () => [],
    ledgerExtractor: ledger ? (state: unknown) => ledger(state) : () => ({}),
    witnessesFactory: () => ({}) as Record<string, never>,
  });

  // Instantiate the simulator
  const sim = new SimClass([], {
    coinPK: "0".repeat(64),
  });

  // Discover available circuits
  const pureNames = Object.keys(sim.circuits.pure);
  const impureNames = Object.keys(sim.circuits.impure);

  return {
    callPure(name: string, ...args: unknown[]) {
      return sim.circuits.pure[name](...args);
    },
    callImpure(name: string, ...args: unknown[]) {
      return sim.circuits.impure[name](...args);
    },
    getPublicState() {
      return sim.getPublicState() ?? {};
    },
    getPrivateState() {
      return sim.getPrivateState();
    },
    getCircuits() {
      return { pure: [...pureNames], impure: [...impureNames] };
    },
    setCaller(coinPK: string) {
      sim.setPersistentCaller(coinPK);
    },
    resetCaller() {
      sim.resetCaller();
    },
    async cleanup() {
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Find the main contract entry file in the bindings. Exported for testing. */
export function findContractEntry(bindings: Record<string, string>): string | null {
  const candidates = [
    "contract/index.cjs",
    "contract/index.js",
    "contract/index.ts",
    "index.cjs",
    "index.js",
    "index.ts",
  ];

  for (const candidate of candidates) {
    if (candidate in bindings) return candidate;
  }

  // Fallback: find any file exporting a Contract class
  for (const [filename, content] of Object.entries(bindings)) {
    if (/export\s+(class|const|function)\s+Contract/.test(content)) {
      return filename;
    }
  }

  return null;
}

/**
 * Resolve node_modules directory for contract dependency resolution.
 * Checks OZ simulator's own node_modules, workspace root, then project root.
 */
function resolveNodeModules(ozSimPath: string): string {
  const candidates = [
    join(ozSimPath, "node_modules"),
    join(ozSimPath, "../../node_modules"), // Workspace root
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fallback to project node_modules
  return join(process.cwd(), "node_modules");
}

/** Resolve the OZ simulator's importable entry point. */
function resolveOzSimulatorEntry(ozSimPath: string): string {
  const candidates = [
    join(ozSimPath, "dist/index.js"),
    join(ozSimPath, "dist/index.cjs"),
    join(ozSimPath, "src/index.ts"),
    join(ozSimPath, "src/index.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  // Default — will produce a clear error at import time
  return pathToFileURL(join(ozSimPath, "dist/index.js")).href;
}
