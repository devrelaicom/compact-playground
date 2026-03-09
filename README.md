# Compact Playground

Compile, format, analyze, and diff [Compact](https://docs.midnight.network/) smart contracts via API. Built for [Learn Compact](https://github.com/Olanetsoft/learn-compact) and the Midnight Network.

**Live API:** https://compact-playground.onrender.com

## Quick Start

```bash
docker run -p 8080:8080 ghcr.io/olanetsoft/compact-playground
```

Or with Docker Compose:

```bash
docker compose up
```

## API Reference

### POST /compile

Compile Compact code. Automatically wraps snippets with pragma and imports.

```bash
curl -X POST http://localhost:8080/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }"}'
```

**Request body:**
```json
{
  "code": "string (required)",
  "options": {
    "wrapWithDefaults": true,
    "skipZk": true,
    "version": "0.26.0"
  }
}
```

**Response:**
```json
{
  "success": true,
  "output": "Compilation successful",
  "executionTime": 3360
}
```

### POST /format

Format Compact code using `compact format`.

```bash
curl -X POST http://localhost:8080/format \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}"}'
```

**Request body:**
```json
{
  "code": "string (required)",
  "options": {
    "diff": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "formatted": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {\n  return (a + b) as Uint<64>;\n}\n",
  "changed": true,
  "diff": "- export circuit add(a:Uint<64>...)  \n+ export circuit add(a: Uint<64>...)"
}
```

### POST /analyze

Analyze contract structure. Two modes: `fast` (source-level parsing) and `deep` (compile + analyze).

```bash
curl -X POST http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }", "mode": "fast"}'
```

**Response:**
```json
{
  "success": true,
  "mode": "fast",
  "pragma": null,
  "imports": [],
  "circuits": [
    {
      "name": "add",
      "exported": true,
      "pure": false,
      "params": [
        {"name": "a", "type": "Uint<64>"},
        {"name": "b", "type": "Uint<64>"}
      ],
      "returnType": "Uint<64>",
      "line": 1
    }
  ],
  "ledger": []
}
```

### POST /diff

Semantic diff between two contract versions. Detects added/removed/modified circuits, ledger fields, imports, and pragma changes.

```bash
curl -X POST http://localhost:8080/diff \
  -H "Content-Type: application/json" \
  -d '{
    "before": "export circuit add(a: Uint<64>): Uint<64> { return a; }",
    "after": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }"
  }'
```

**Response:**
```json
{
  "success": true,
  "hasChanges": true,
  "circuits": {
    "added": [],
    "removed": [],
    "modified": [{"name": "add", "changes": ["params"]}]
  },
  "ledger": {"added": [], "removed": [], "modified": []},
  "pragma": {"before": null, "after": null, "changed": false},
  "imports": {"added": [], "removed": []}
}
```

### POST /matrix

Compile a contract against multiple compiler versions and return a pass/fail matrix.

```bash
curl -X POST http://localhost:8080/matrix \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit test(): [] {}", "versions": ["0.25.0", "0.26.0"]}'
```

**Response:**
```json
{
  "success": true,
  "matrix": [
    {"version": "0.25.0", "success": true, "executionTime": 3200},
    {"version": "0.26.0", "success": true, "executionTime": 3100}
  ]
}
```

### GET /versions

List installed compiler versions and the default.

```bash
curl http://localhost:8080/versions
```

**Response:**
```json
{
  "default": "latest",
  "installed": ["0.26.0"]
}
```

### GET /health

Health check with compiler status.

```bash
curl http://localhost:8080/health
```

**Response:**
```json
{
  "status": "healthy",
  "compiler": {"installed": true, "version": "0.26.0"},
  "timestamp": "2026-03-09T14:00:00.000Z"
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `DEFAULT_COMPILER_VERSION` | `latest` | Default compiler version. Set to a specific version (e.g. `0.26.0`) for Learn Compact compatibility. |
| `TEMP_DIR` | `/tmp/compact-playground` | Temporary directory for compilation |
| `COMPACT_CLI_PATH` | `compact` | Path to the compact CLI |
| `COMPILE_TIMEOUT` | `30000` | Compilation timeout in ms |
| `RATE_LIMIT` | `20` | Max requests per window per IP |
| `RATE_WINDOW` | `60000` | Rate limit window in ms |
| `CACHE_ENABLED` | `true` | Enable compilation cache |
| `CACHE_MAX_SIZE` | `1000` | Max cache entries |
| `CACHE_TTL` | `3600000` | Cache TTL in ms (1 hour) |

> **Learn Compact note:** Set `DEFAULT_COMPILER_VERSION=0.26.0` to pin the compiler version to match `pragma language_version >= 0.16 && <= 0.18`.

## Deployment

### Docker

```bash
docker build -t compact-playground .
docker run -p 8080:8080 compact-playground
```

### Docker Compose

```bash
docker compose up
```

Configure via `.env` (see `.env.example`).

### Railway

1. Fork this repo
2. Create a new project on [Railway](https://railway.app)
3. Connect the repo — Railway auto-detects the `railway.toml` config
4. Deploy

### Fly.io

```bash
fly launch --copy-config
fly deploy
```

### Render.com

1. Fork this repo
2. Create Web Service on [render.com](https://render.com)
3. Connect repo, select Docker runtime
4. Deploy

## mdBook Integration

1. Copy `frontend/compact-playground.js` and `frontend/compact-playground.css` to your mdBook

2. Add to `book.toml`:
```toml
[output.html]
additional-js = ["compact-playground.js"]
additional-css = ["compact-playground.css"]
```

3. Use `compact` language in code blocks:
````markdown
```compact
export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
    return (a + b) as Uint<64>;
}
```
````

Code blocks get a Run button. Press `Ctrl+Enter` to compile.

## Development

```bash
npm install
npm run dev:node  # Watch mode (requires compact toolchain locally)
npm run test:run  # Run tests
```

## License

MIT
