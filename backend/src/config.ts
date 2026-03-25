import { randomBytes } from "node:crypto";

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const trimmed = raw.trim();
  if (trimmed === "" || !/^-?\d+$/.test(trimmed)) {
    throw new Error(`Invalid integer for ${name}: "${raw}"`);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for ${name}: "${raw}"`);
  }

  return parsed;
}

export interface Config {
  port: number;
  defaultCompilerVersion: string;
  tempDir: string;
  compactCliPath: string;
  compileTimeout: number;
  formatTimeout: number;
  maxConcurrentExecutions: number;
  maxQueueSize: number;
  rateLimit: number;
  rateWindow: number;
  cacheEnabled: boolean;
  cacheDir: string;
  cacheMaxDiskMb: number;
  cacheMaxEntries: number;
  cacheTtl: number;
  cacheKeySalt: string;
  usingEphemeralCacheSalt: boolean;
  maxVersionsPerRequest: number;
  maxCodeSize: number;
  maxJsonBodySize: number;
  archiveRateLimit: number;
  archiveRateWindow: number;
  trustCloudflare: boolean;
  trustProxy: boolean;
  ozContractsPath: string;
}

let _config: Config | null = null;
let _ephemeralCacheSalt: string | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const usingEphemeralCacheSalt = !process.env.CACHE_KEY_SALT;
  if (usingEphemeralCacheSalt && !_ephemeralCacheSalt) {
    _ephemeralCacheSalt = randomBytes(32).toString("hex");
  }

  _config = {
    port: parseIntEnv("PORT", 8080),
    defaultCompilerVersion: process.env.DEFAULT_COMPILER_VERSION || "latest",
    tempDir: process.env.TEMP_DIR || "/tmp/compact-playground",
    compactCliPath: process.env.COMPACT_CLI_PATH || "compact",
    compileTimeout: parseIntEnv("COMPILE_TIMEOUT", 30000),
    formatTimeout: parseIntEnv("FORMAT_TIMEOUT", 10000),
    maxConcurrentExecutions: parseIntEnv("MAX_CONCURRENT_EXECUTIONS", 3),
    maxQueueSize: parseIntEnv("MAX_QUEUE_SIZE", 100),
    rateLimit: parseIntEnv("RATE_LIMIT", 20),
    rateWindow: parseIntEnv("RATE_WINDOW", 60000),
    cacheEnabled: process.env.CACHE_ENABLED !== "false",
    cacheDir: process.env.CACHE_DIR || "/data/cache",
    cacheMaxDiskMb: parseIntEnv("CACHE_MAX_DISK_MB", 800),
    cacheMaxEntries: parseIntEnv("CACHE_MAX_ENTRIES", 50000),
    cacheTtl: parseIntEnv("CACHE_TTL", 2592000000), // 30 days
    cacheKeySalt: process.env.CACHE_KEY_SALT || _ephemeralCacheSalt || "",
    usingEphemeralCacheSalt,
    maxVersionsPerRequest: parseIntEnv("MAX_VERSIONS_PER_REQUEST", 3),
    maxCodeSize: parseIntEnv("MAX_CODE_SIZE", 100 * 1024),
    maxJsonBodySize: parseIntEnv("MAX_JSON_BODY_SIZE", 512 * 1024),
    archiveRateLimit: parseIntEnv("ARCHIVE_RATE_LIMIT", 10),
    archiveRateWindow: parseIntEnv("ARCHIVE_RATE_WINDOW", 60000),
    trustCloudflare: process.env.TRUST_CLOUDFLARE === "true",
    trustProxy: process.env.TRUST_PROXY === "true",
    ozContractsPath: process.env.OZ_CONTRACTS_PATH || "/opt/oz-compact/contracts/src",
  };

  return _config;
}

/** Reset config singleton (for testing only) */
export function resetConfig(): void {
  _config = null;
  _ephemeralCacheSalt = null;
}
