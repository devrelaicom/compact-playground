/**
 * Global test setup — disables the file cache by default so tests don't
 * attempt writes to /data/cache. Tests that need the cache (e.g.
 * compiler.test.ts) set CACHE_DIR to a temp directory and must also
 * reset CACHE_ENABLED.
 */
if (!process.env.CACHE_DIR && !process.env.CACHE_ENABLED) {
  process.env.CACHE_ENABLED = "false";
}
