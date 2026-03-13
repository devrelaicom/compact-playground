import { readdir } from "fs/promises";
import { join, basename } from "path";
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
