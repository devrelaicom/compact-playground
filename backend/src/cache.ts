import { createHash } from "crypto";
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { getConfig } from "./config.js";

/** Normalize code for cache key generation (lightweight, no formatter needed) */
export function normalizeForCacheKey(code: string): string {
  return code.trim().replace(/\r\n/g, "\n");
}

/** Generate a deterministic cache key from code + version + options */
export function generateCacheKey(
  code: string,
  compilerVersion: string,
  options: Record<string, unknown>,
): string {
  const normalized = normalizeForCacheKey(code);
  const payload = JSON.stringify({ code: normalized, version: compilerVersion, options });
  return createHash("sha256").update(payload).digest("hex");
}

interface IndexEntry {
  endpoint: string;
  atime: number;
  size: number;
}

interface CacheEnvelope<T> {
  createdAt: number;
  data: T;
}

export class FileCache {
  private baseDir: string;
  private ttl: number;
  private maxDiskMb: number;
  private maxEntries: number;
  private index = new Map<string, IndexEntry>();
  private _hits = 0;
  private _misses = 0;

  constructor(baseDir: string, ttl: number, maxDiskMb: number, maxEntries: number) {
    this.baseDir = baseDir;
    this.ttl = ttl;
    this.maxDiskMb = maxDiskMb;
    this.maxEntries = maxEntries;
  }

  /** Rebuild index from disk, delete expired entries */
  async init(): Promise<void> {
    const endpoints = ["compile", "format", "analyze", "diff"];

    for (const endpoint of endpoints) {
      const endpointDir = join(this.baseDir, endpoint);
      try {
        await mkdir(endpointDir, { recursive: true });
      } catch {
        continue;
      }

      try {
        await this.walkDir(endpointDir, endpoint);
      } catch {
        // Directory doesn't exist or can't be read — skip
      }
    }

    // Purge expired and over-limit entries
    await this.purge();
    console.log(`FileCache initialized: ${String(this.index.size)} entries loaded from disk`);
  }

  private async walkDir(dir: string, endpoint: string): Promise<void> {
    let subdirs: string[];
    try {
      subdirs = await readdir(dir);
    } catch {
      return;
    }

    for (const subdir of subdirs) {
      const subdirPath = join(dir, subdir);
      let files: string[];
      try {
        const s = await stat(subdirPath);
        if (!s.isDirectory()) continue;
        files = await readdir(subdirPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const key = file.slice(0, -5); // remove .json
        const filePath = join(subdirPath, file);

        try {
          const content = await readFile(filePath, "utf-8");
          const envelope = JSON.parse(content) as CacheEnvelope<unknown>;

          if (Date.now() - envelope.createdAt > this.ttl) {
            // Expired — delete
            await unlink(filePath).catch(() => {});
            continue;
          }

          const fileStat = await stat(filePath);
          this.index.set(key, {
            endpoint,
            atime: Date.now(),
            size: fileStat.size,
          });
        } catch {
          // Corrupted file — delete it
          await unlink(filePath).catch(() => {});
        }
      }
    }
  }

  private filePath(endpoint: string, key: string): string {
    return join(this.baseDir, endpoint, key.slice(0, 2), `${key}.json`);
  }

  async get<T>(endpoint: string, key: string): Promise<T | undefined> {
    const entry = this.index.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    const path = this.filePath(endpoint, key);
    try {
      const content = await readFile(path, "utf-8");
      const envelope = JSON.parse(content) as CacheEnvelope<T>;

      // Check TTL
      if (Date.now() - envelope.createdAt > this.ttl) {
        // Expired — lazy delete
        this.index.delete(key);
        await unlink(path).catch(() => {});
        this._misses++;
        return undefined;
      }

      // Update atime in index
      entry.atime = Date.now();
      this._hits++;
      return envelope.data;
    } catch {
      // File missing or corrupted — remove from index
      this.index.delete(key);
      this._misses++;
      return undefined;
    }
  }

  async set(endpoint: string, key: string, data: unknown): Promise<void> {
    const path = this.filePath(endpoint, key);
    const envelope: CacheEnvelope<unknown> = {
      createdAt: Date.now(),
      data,
    };

    try {
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.tmp`;
      const content = JSON.stringify(envelope);
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, path);

      this.index.set(key, {
        endpoint,
        atime: Date.now(),
        size: content.length,
      });

      // Async purge if over entry limit
      if (this.index.size > this.maxEntries) {
        this.purge().catch(() => {});
      }
    } catch (err) {
      console.warn("FileCache write error:", err);
    }
  }

  /** Delete expired entries, then evict LRU if over disk or entry limits */
  async purge(): Promise<number> {
    let deleted = 0;

    // Evict if over entry limit
    if (this.index.size > this.maxEntries) {
      const sorted = [...this.index.entries()].sort((a, b) => a[1].atime - b[1].atime);
      const toEvict = sorted.slice(0, this.index.size - this.maxEntries);
      for (const [key, entry] of toEvict) {
        const path = this.filePath(entry.endpoint, key);
        await unlink(path).catch(() => {});
        this.index.delete(key);
        deleted++;
      }
    }

    // Pass 3: evict if over disk limit
    const totalBytes = [...this.index.values()].reduce((sum, e) => sum + e.size, 0);
    const maxBytes = this.maxDiskMb * 1024 * 1024;
    if (totalBytes > maxBytes) {
      const sorted = [...this.index.entries()].sort((a, b) => a[1].atime - b[1].atime);
      let currentBytes = totalBytes;
      for (const [key, entry] of sorted) {
        if (currentBytes <= maxBytes) break;
        const path = this.filePath(entry.endpoint, key);
        await unlink(path).catch(() => {});
        currentBytes -= entry.size;
        this.index.delete(key);
        deleted++;
      }
    }

    return deleted;
  }

  stats(): { entries: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      entries: this.index.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }
}

let _fileCache: FileCache | null = null;

/** Get the singleton FileCache instance (or null if caching is disabled) */
export function getFileCache(): FileCache | null {
  const config = getConfig();
  if (!config.cacheEnabled) return null;

  if (!_fileCache) {
    _fileCache = new FileCache(
      config.cacheDir,
      config.cacheTtl,
      config.cacheMaxDiskMb,
      config.cacheMaxEntries,
    );
  }
  return _fileCache;
}

/** Reset file cache singleton (for testing) */
export function resetFileCache(): void {
  _fileCache = null;
}
