# Backend Architecture

## How It Works

The playground uses the Compact CLI (`compact`) to compile, format, and analyze Compact smart contracts inside a Docker container. Multiple compiler versions are pre-installed and selectable per request.

When a user submits code:

1. The request body is validated with Zod schemas
2. Rate limiting is checked against the client IP
3. Code is written to a temp directory
4. The appropriate `compact` subcommand is executed (compile, format, etc.) with the requested compiler version
5. Output/errors are parsed and returned as JSON
6. Temp files are cleaned up

## Compact Repositories

| Repository | Purpose |
|------------|---------|
| [LFDT-Minokawa/compact](https://github.com/LFDT-Minokawa/compact) | Source code (Scheme-based compiler) |
| [midnightntwrk/compact](https://github.com/midnightntwrk/compact) | Pre-built binaries (releases) |

## Compiler Setup

The Dockerfile installs the Compact CLI and pre-installs multiple compiler versions:

### 1. Compact CLI (`compact`)
- Release: `compact-v0.4.0`
- Purpose: Toolchain manager that handles compiler version selection and subcommands

### 2. Compiler Versions
Pre-installed via `compact update <version>` during Docker build:
- 0.29.0, 0.28.0, 0.26.0, 0.25.0, 0.24.0, 0.23.0, 0.22.0

The CLI's `compact update` command downloads and installs compiler versions. At runtime, version selection works as follows:
- **Compilation**: `compact compile +VERSION --skip-zk <source> <output>`
- **Formatting**: `compact format --directory <version-dir> <file>` (format does not support `+VERSION` syntax, so an isolated directory is prepared via `compact update VERSION --directory DIR`)

### Updating Compiler Versions

To add a new compiler version:

1. Check releases at https://github.com/midnightntwrk/compact/releases
2. Add a `compact update X.Y.Z` line to the Dockerfile
3. Test locally: `docker build -t compact-playground . && docker run -p 8080:8080 compact-playground`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | Root | Service info and endpoint listing |
| `GET /health` | Health | Service health with version status |
| `GET /versions` | Versions | Installed compiler versions with language version mapping |
| `POST /compile` | Compile | Compile Compact code |
| `POST /format` | Format | Format Compact code |
| `POST /analyze` | Analyze | Analyze contract structure (fast/deep) |
| `POST /diff` | Diff | Semantic diff between two contract versions |

### Version Selection

All POST endpoints accept version selection:
- `"latest"` -- newest installed compiler
- `"detect"` -- parse `pragma language_version` from source to find the best compiler match, fall back to default
- Specific version (e.g. `"0.29.0"`) -- must be installed
- `versions` array -- run the operation against multiple compiler versions in parallel

### Compilation Flags

`--skip-zk` is used by default for faster compilation (~3s vs ~30s+). This skips ZK proving key generation but still performs full type checking and semantic analysis. To enable ZK generation, pass `skipZk: false` in the options.

## File Structure

```
backend/src/
├── index.ts              # Hono server setup, middleware, route mounting
├── config.ts             # Centralised configuration from env vars
├── middleware.ts          # JSON validation middleware, multi-version runner
├── request-schemas.ts    # Zod schemas for all POST request bodies
├── rate-limit.ts         # IP extraction (proxy/Cloudflare/runtime) and rate limiting
├── compiler.ts           # Spawns `compact compile`, handles output/timeouts
├── formatter.ts          # Spawns `compact format` via --directory isolation
├── analyzer.ts           # Static contract structure analysis
├── differ.ts             # Semantic diff between contract versions
├── parser.ts             # Parses compiler error/warning messages
├── wrapper.ts            # Auto-wraps code with pragma/imports when missing
├── cache.ts              # LRU compile result cache
├── version-manager.ts    # Multi-version management, pragma detection, version dir prep
├── utils.ts              # CLI version check helper
└── routes/
    ├── compile.ts        # POST /compile
    ├── format.ts         # POST /format
    ├── analyze.ts        # POST /analyze
    ├── diff.ts           # POST /diff
    └── health.ts         # GET /health, GET /versions
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `TEMP_DIR` | `/tmp/compact-playground` | Temp directory for compilation sessions |
| `COMPACT_CLI_PATH` | `compact` | Path to the Compact CLI binary |
| `DEFAULT_COMPILER_VERSION` | `latest` | Default compiler version when none specified |
| `COMPILE_TIMEOUT` | `30000` | Compilation timeout in ms |
| `RATE_LIMIT` | `20` | Max requests per IP per window |
| `RATE_WINDOW` | `60000` | Rate limit window in ms |
| `CACHE_ENABLED` | `true` | Enable compile result caching |
| `CACHE_MAX_SIZE` | `1000` | Max cached results |
| `CACHE_TTL` | `3600000` | Cache entry TTL in ms (1 hour) |
| `MAX_VERSIONS_PER_REQUEST` | `10` | Max versions in a multi-version request |
| `MAX_CODE_SIZE` | `102400` | Max code size in bytes (100 KB) |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` / `X-Real-IP` headers for client IP |
| `TRUST_CLOUDFLARE` | `false` | Trust `CF-Connecting-IP` header for client IP |

## Rate Limiting and IP Extraction

Client IP is determined with a 4-level precedence:

1. **Cloudflare** (`TRUST_CLOUDFLARE=true`): reads `CF-Connecting-IP`
2. **Proxy** (`TRUST_PROXY=true`): reads `X-Forwarded-For` (first IP) or `X-Real-IP`
3. **Runtime**: reads `c.env.incoming.socket.remoteAddress` from the `@hono/node-server` adapter
4. Falls back to `"unknown"`

By default, no headers are trusted -- only the adapter-provided runtime IP is used. Enable `TRUST_CLOUDFLARE` or `TRUST_PROXY` only when running behind the corresponding infrastructure.
