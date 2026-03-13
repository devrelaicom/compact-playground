import { readdir, symlink, readFile, access as fsAccess } from "fs/promises";
import { join, basename } from "path";
import { constants } from "fs";
import { getConfig } from "./config.js";

export interface LibraryInfo {
  name: string;
  domain: string;
  path: string;
}

const DOMAINS = ["access", "security", "token", "utils"];

export async function listAvailableLibraries(): Promise<LibraryInfo[]> {
  const config = getConfig();
  const libs: LibraryInfo[] = [];

  for (const domain of DOMAINS) {
    const domainDir = join(config.ozContractsPath, domain);
    try {
      const entries = await readdir(domainDir);
      for (const entry of entries) {
        if (entry.endsWith(".compact")) {
          const name = basename(entry, ".compact");
          libs.push({
            name,
            domain,
            path: `${domain}/${name}`,
          });
        }
      }
    } catch {
      // Domain directory doesn't exist, skip
    }
  }

  return libs;
}

export async function linkLibraries(libraries: string[], targetDir: string): Promise<string[]> {
  const config = getConfig();
  const ozRoot = config.ozContractsPath;

  // Validate OZ contracts are installed
  try {
    await fsAccess(ozRoot, constants.R_OK);
  } catch {
    throw new Error(
      "OpenZeppelin Compact contracts are not installed. OZ library imports are unavailable.",
    );
  }

  const domainsNeeded = new Set<string>();
  const resolvedPaths: string[] = [];

  for (const lib of libraries) {
    const parts = lib.split("/");
    const domain = parts[0];
    const moduleName = parts[1];

    if (!domain || !moduleName) {
      throw new Error(
        `Invalid library path "${lib}". Use "domain/ModuleName" format (e.g., "access/Ownable").`,
      );
    }

    // Verify the .compact file exists
    const compactFile = join(ozRoot, domain, `${moduleName}.compact`);
    try {
      await fsAccess(compactFile, constants.R_OK);
    } catch {
      throw new Error(`Library "${lib}" not found. Check available libraries via GET /libraries.`);
    }

    domainsNeeded.add(domain);
    resolvedPaths.push(lib);

    // Scan for cross-domain imports to resolve transitive dependencies
    const content = await readFile(compactFile, "utf-8");
    const importMatches = content.matchAll(/import\s+"\.\.\/([^/]+)\//g);
    for (const match of importMatches) {
      domainsNeeded.add(match[1]);
    }
  }

  // Symlink each needed domain directory into the target
  for (const domain of domainsNeeded) {
    const source = join(ozRoot, domain);
    const target = join(targetDir, domain);
    try {
      await fsAccess(source, constants.R_OK);
      await symlink(source, target, "dir");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        try {
          await fsAccess(source, constants.R_OK);
        } catch {
          continue;
        }
        throw err;
      }
    }
  }

  return resolvedPaths;
}
