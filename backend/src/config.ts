export interface Config {
  port: number;
  defaultCompilerVersion: string;
  tempDir: string;
  compactCliPath: string;
  compileTimeout: number;
  rateLimit: number;
  rateWindow: number;
  cacheEnabled: boolean;
  cacheDir: string;
  cacheMaxDiskMb: number;
  cacheMaxEntries: number;
  cacheTtl: number;
  maxVersionsPerRequest: number;
  maxCodeSize: number;
  maxJsonBodySize: number;
  archiveRateLimit: number;
  archiveRateWindow: number;
  trustCloudflare: boolean;
  trustProxy: boolean;
  ozContractsPath: string;
  ozSimulatorPath: string;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  _config = {
    port: parseInt(process.env.PORT || "8080", 10),
    defaultCompilerVersion: process.env.DEFAULT_COMPILER_VERSION || "latest",
    tempDir: process.env.TEMP_DIR || "/tmp/compact-playground",
    compactCliPath: process.env.COMPACT_CLI_PATH || "compact",
    compileTimeout: parseInt(process.env.COMPILE_TIMEOUT || "30000", 10),
    rateLimit: parseInt(process.env.RATE_LIMIT || "20", 10),
    rateWindow: parseInt(process.env.RATE_WINDOW || "60000", 10),
    cacheEnabled: process.env.CACHE_ENABLED !== "false",
    cacheDir: process.env.CACHE_DIR || "/data/cache",
    cacheMaxDiskMb: parseInt(process.env.CACHE_MAX_DISK_MB || "800", 10),
    cacheMaxEntries: parseInt(process.env.CACHE_MAX_ENTRIES || "50000", 10),
    cacheTtl: parseInt(process.env.CACHE_TTL || "2592000000", 10), // 30 days
    maxVersionsPerRequest: parseInt(process.env.MAX_VERSIONS_PER_REQUEST || "3", 10),
    maxCodeSize: parseInt(process.env.MAX_CODE_SIZE || String(100 * 1024), 10),
    maxJsonBodySize: parseInt(process.env.MAX_JSON_BODY_SIZE || String(512 * 1024), 10),
    archiveRateLimit: parseInt(process.env.ARCHIVE_RATE_LIMIT || "10", 10),
    archiveRateWindow: parseInt(process.env.ARCHIVE_RATE_WINDOW || "60000", 10),
    trustCloudflare: process.env.TRUST_CLOUDFLARE === "true",
    trustProxy: process.env.TRUST_PROXY === "true",
    ozContractsPath: process.env.OZ_CONTRACTS_PATH || "/opt/oz-compact/contracts/src",
    ozSimulatorPath: process.env.OZ_SIMULATOR_PATH || "/opt/oz-compact/packages/simulator",
  };

  return _config;
}

/** Reset config singleton (for testing only) */
export function resetConfig(): void {
  _config = null;
}
