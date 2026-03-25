# Backend Architecture

## How It Works

The playground uses the Compact CLI (`compact`) to compile, format, and analyze Compact smart contracts inside a Docker container. Multiple compiler versions are pre-installed and selectable per request. OpenZeppelin Compact modules are available for import.

When a user submits code:

1. The request body is validated with Zod schemas
2. Rate limiting is checked against the client IP
3. Code is written to a temp directory
4. The appropriate `compact` subcommand is executed (compile, format, etc.) with the requested compiler version
5. Output/errors are parsed and returned as JSON
6. Results are cached to disk and exposed via opaque cache tokens for subsequent lookups
7. Temp files are cleaned up

## Compact Repositories

| Repository | Purpose |
|------------|---------|
| [LFDT-Minokawa/compact](https://github.com/LFDT-Minokawa/compact) | Source code (Scheme-based compiler) |
| [midnightntwrk/compact](https://github.com/midnightntwrk/compact) | Pre-built binaries (releases) |
| [OpenZeppelin/compact-contracts](https://github.com/OpenZeppelin/compact-contracts) | OpenZeppelin Compact modules |

## Compiler Setup

The Dockerfile installs the Compact CLI and pre-installs multiple compiler versions:

### 1. Compact CLI (`compact`)
- Release: `compact-v0.5.0`
- Purpose: Toolchain manager that handles compiler version selection and subcommands

### 2. Compiler Versions
Pre-installed via `compact update <version>` during Docker build:
- 0.30.0, 0.29.0, 0.28.0, 0.26.0, 0.25.0, 0.24.0, 0.23.0, 0.22.0

The CLI's `compact update` command downloads and installs compiler versions. At runtime, version selection works as follows:
- **Compilation**: `compact compile +VERSION --skip-zk <source> <output>`
- **Formatting**: `compact format --directory <version-dir> <file>` (format does not support `+VERSION` syntax, so an isolated directory is prepared via `compact update VERSION --directory DIR` with binaries symlinked from the global compact home)

### 3. OpenZeppelin Compact Modules
The Docker image clones a pinned commit of `OpenZeppelin/compact-contracts` into `/opt/oz-compact`. Available library domains: `access`, `security`, `token`, `utils`. Modules are symlinked into compilation directories on demand via the `libraries` option.

### Updating Compiler Versions

To add a new compiler version:

1. Check releases at https://github.com/midnightntwrk/compact/releases
2. Add a `compact update X.Y.Z` line to the Dockerfile
3. Test locally: `docker build -t compact-playground . && docker run -p 8080:8080 compact-playground`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | Root | Service info and endpoint listing |
| `GET /health` | Health | Service health with compiler versions, cache stats, and OZ dependency status |
| `GET /versions` | Versions | Installed compiler versions with language version mapping |
| `GET /libraries` | Libraries | Available OpenZeppelin Compact modules by domain |
| `POST /compile` | Compile | Compile Compact code (single or multi-version) |
| `POST /compile/archive` | Archive Compile | Compile multi-file `.tar.gz` archives |
| `POST /format` | Format | Format Compact code |
| `POST /analyze` | Analyze | 5-stage analysis pipeline (fast/deep, multi-version) |
| `POST /visualize` | Visualize | Contract architecture graph (DAG + Mermaid diagram) |
| `POST /prove` | Prove | ZK privacy boundary analysis |
| `POST /diff` | Diff | Semantic diff between two contract versions |
| `GET /cached-response/:hash` | Cache Lookup | Retrieve any cached result by opaque cache token |

### Version Selection

All POST endpoints that compile code accept version selection:
- `"latest"` -- newest installed compiler
- `"detect"` -- parse `pragma language_version` from source to find the best compiler match, fall back to default
- Specific version (e.g. `"0.30.0"`) -- must be installed
- `versions` array -- run the operation against multiple compiler versions in parallel

### Compile Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `skipZk` | boolean | `true` | Skip ZK proving key generation for faster compilation |
| `includeBindings` | boolean | `false` | Return compiler-generated TypeScript artifacts (forces full ZK compilation) |
| `libraries` | string[] | - | OZ modules to link, e.g. `["access/Ownable"]` (max 20, Docker only) |
| `wrapWithDefaults` | boolean | - | Auto-wrap code with pragma/imports if missing |
| `timeout` | number | `30000` | Compilation timeout in ms |

### Compile Response Fields

| Field | Description |
|-------|-------------|
| `success` | Whether compilation succeeded |
| `output` | Human-readable result message |
| `errors` / `warnings` | Parsed compiler diagnostics with file, line, column, severity |
| `insights` | Circuit metadata from compiler output (names, k-values, row counts) -- requires full ZK compilation |
| `bindings` | TypeScript artifacts from compiler output -- requires `includeBindings: true` |
| `cacheKey` | Opaque cache token for retrieving this result via `GET /cached-response/:hash` |

### Caching

Responses from `/compile`, `/format`, `/diff`, `/analyze`, and `/prove` include a `cacheKey` field (opaque token). Any cached result can be retrieved later via `GET /cached-response/:hash` without re-running the operation.

Cache is persisted to disk at `CACHE_DIR` with configurable size limits and TTL.

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
├── differ.ts             # Semantic diff between contract versions
├── parser.ts             # Parses compiler error/warning messages and insights
├── wrapper.ts            # Auto-wraps code with pragma/imports when missing
├── cache.ts              # File-based persistent cache with LRU eviction
├── version-manager.ts    # Multi-version management, pragma detection, version dir prep
├── libraries.ts          # OZ library resolver and symlink manager
├── visualizer.ts         # Contract architecture graph generator
├── archive.ts            # Tar.gz extraction with security validation
├── archive-compiler.ts   # Multi-file archive compilation orchestrator
├── utils.ts              # CLI version check helper
├── analysis/
│   ├── index.ts          # 5-stage analysis pipeline orchestrator
│   ├── parser.ts         # Compact source code parser (AST)
│   ├── semantic-model.ts # Semantic model builder (circuits, ledger, witnesses)
│   ├── types.ts          # Analysis type definitions
│   ├── rules.ts          # Static analysis rules engine
│   ├── recommendations.ts # Recommendation generator
│   ├── explanations.ts   # Circuit explanation generator
│   └── proof-analysis.ts # ZK privacy boundary analysis engine
└── routes/
    ├── compile.ts        # POST /compile
    ├── compile-archive.ts # POST /compile/archive
    ├── format.ts         # POST /format
    ├── analyze.ts        # POST /analyze
    ├── visualize.ts      # POST /visualize
    ├── prove.ts          # POST /prove
    ├── diff.ts           # POST /diff
    ├── cached-response.ts # GET /cached-response/:hash
    └── health.ts         # GET /health, GET /versions, GET /libraries
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
| `ARCHIVE_RATE_LIMIT` | `10` | Max archive compile requests per IP per window |
| `ARCHIVE_RATE_WINDOW` | `60000` | Archive rate limit window in ms |
| `CACHE_ENABLED` | `true` | Enable file-based result caching |
| `CACHE_DIR` | `/data/cache` | Persistent cache directory |
| `CACHE_MAX_DISK_MB` | `800` | Max cache disk usage in MB |
| `CACHE_MAX_ENTRIES` | `50000` | Max cached entries |
| `CACHE_TTL` | `2592000000` | Cache entry TTL in ms (30 days) |
| `MAX_VERSIONS_PER_REQUEST` | `3` | Max versions in a multi-version request |
| `MAX_CODE_SIZE` | `102400` | Max code size in bytes (100 KB) |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` / `X-Real-IP` headers for client IP |
| `TRUST_CLOUDFLARE` | `false` | Trust `CF-Connecting-IP` header for client IP |
| `OZ_CONTRACTS_PATH` | `/opt/oz-compact/contracts/src` | Path to OpenZeppelin Compact contracts |

## Rate Limiting and IP Extraction

Client IP is determined with a 4-level precedence:

1. **Cloudflare** (`TRUST_CLOUDFLARE=true`): reads `CF-Connecting-IP`
2. **Proxy** (`TRUST_PROXY=true`): reads `X-Forwarded-For` (first IP) or `X-Real-IP`
3. **Runtime**: reads `c.env.incoming.socket.remoteAddress` from the `@hono/node-server` adapter
4. Falls back to `"unknown"`

By default, no headers are trusted -- only the adapter-provided runtime IP is used. Enable `TRUST_CLOUDFLARE` or `TRUST_PROXY` only when running behind the corresponding infrastructure.

Standard endpoints: 20 requests per 60 seconds per IP. Archive compilation: 10 requests per 60 seconds per IP.

## Known Limitations

- **ARM Docker**: The Compact CLI only provides `x86_64-unknown-linux-musl` binaries (no `aarch64-linux` build exists). On ARM systems (e.g., Apple Silicon running Docker), the `zkir` binary can start under emulation but crashes with SIGILL (Illegal Instruction) during proof key generation because the BLS12-381 assembly in the `blst` cryptography library uses x86 instructions the emulator cannot handle. This affects full ZK compilation (`skipZk: false`), `includeBindings`, and `insights`. Compilation with `--skip-zk` (the default) works correctly. Full ZK compilation works on native x86_64 hosts (e.g., Fly.io).
