# Backend Architecture

## How It Works

The playground runs the real Compact compiler (`compactc`) inside a Docker container. When a user submits code:

1. Code is written to a temp file
2. `compactc --skip-zk <file> <output-dir>` is executed
3. Output/errors are parsed and returned as JSON
4. Temp files are cleaned up

## Compiler Setup

The Dockerfile downloads two separate releases from [midnightntwrk/compact](https://github.com/midnightntwrk/compact):

### 1. Compact CLI (`compact`)
- Release: `compact-v0.3.0`
- File: `compact-x86_64-unknown-linux-musl.tar.xz`
- Purpose: Toolchain manager (not used at runtime, but included)

### 2. Compact Compiler (`compactc`)
- Release: `compactc-v0.26.0`
- File: `compactc_v0.26.0_x86_64-unknown-linux-musl.zip`
- Contains:
  - `compactc` - wrapper script
  - `compactc.bin` - actual compiler binary
  - `zkir` - ZK circuit generator
  - `fixup-compact`, `format-compact` - utilities

**Key insight:** The CLI tool (`compact`) and compiler (`compactc`) are released separately. The CLI's `compact update` command downloads the compiler, but in Docker we download `compactc` directly to avoid network issues during build.

## Updating Compiler Version

When a new compiler version is released:

1. Check releases at https://github.com/midnightntwrk/compact/releases
2. Find the `compactc-vX.Y.Z` release (not `compact-vX.Y.Z`)
3. Update the Dockerfile:

```dockerfile
# Change this URL to the new version
RUN curl -fsSL https://github.com/midnightntwrk/compact/releases/download/compactc-vX.Y.Z/compactc_vX.Y.Z_x86_64-unknown-linux-musl.zip \
    -o /tmp/compactc.zip \
    ...
```

4. Test locally: `docker build -t compact-playground . && docker run -p 8080:8080 compact-playground`
5. Push to trigger Render redeploy

## Compilation Flags

We use `--skip-zk` by default for faster compilation (~3s vs ~30s+). This skips ZK proving key generation but still performs full type checking and semantic analysis.

To enable ZK generation, pass `skipZk: false` in the API request (not recommended for playground use due to time/resource constraints).

## File Structure

```
backend/src/
├── index.ts      # Hono server, routes, rate limiting
├── compiler.ts   # Spawns compactc, handles output
├── parser.ts     # Parses compiler error messages
├── wrapper.ts    # Auto-wraps code with pragma/imports
└── utils.ts      # Version check, helpers
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `TEMP_DIR` | `/tmp/compact-playground` | Where temp files are created |
| `COMPACT_PATH` | `compactc` | Path to compiler binary |
