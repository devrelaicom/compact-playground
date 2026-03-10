export interface Config {
  port: number;
  defaultCompilerVersion: string;
  tempDir: string;
  compactCliPath: string;
  compileTimeout: number;
  rateLimit: number;
  rateWindow: number;
  cacheEnabled: boolean;
  cacheMaxSize: number;
  cacheTtl: number;
  maxVersionsPerRequest: number;
  maxCodeSize: number;
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
    cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || "1000", 10),
    cacheTtl: parseInt(process.env.CACHE_TTL || "3600000", 10), // 1 hour
    maxVersionsPerRequest: parseInt(process.env.MAX_VERSIONS_PER_REQUEST || "10", 10),
    maxCodeSize: parseInt(process.env.MAX_CODE_SIZE || String(100 * 1024), 10),
  };

  return _config;
}

/** Reset config singleton (for testing only) */
export function resetConfig(): void {
  _config = null;
}
