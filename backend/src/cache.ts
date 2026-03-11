import { createHash } from "crypto";
import type { CompileResult } from "./compiler.js";

interface CacheEntry {
  result: Partial<CompileResult>;
  timestamp: number;
}

interface CacheOptions {
  maxSize: number;
  ttl: number; // milliseconds
}

export class CompileCache {
  private cache = new Map<string, CacheEntry>();
  private _hits = 0;
  private _misses = 0;
  private maxSize: number;
  private ttl: number;

  constructor(options: CacheOptions) {
    this.maxSize = options.maxSize;
    this.ttl = options.ttl;
  }

  get(key: string): Partial<CompileResult> | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this._misses++;
      return undefined;
    }

    this._hits++;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  set(key: string, result: Partial<CompileResult>): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      size: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }
}

/** Normalize code for cache key generation (lightweight, no formatter needed) */
export function normalizeForCacheKey(code: string): string {
  return code.trim().replace(/\r\n/g, "\n");
}

/** Generate a deterministic cache key from code + version + options */
export function generateCacheKey(
  code: string,
  compilerVersion: string,
  options: Record<string, unknown>
): string {
  const normalized = normalizeForCacheKey(code);
  const payload = JSON.stringify({ code: normalized, version: compilerVersion, options });
  return createHash("sha256").update(payload).digest("hex");
}
