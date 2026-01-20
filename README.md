# Compact Playground

Compile Compact smart contracts in the browser. Built for [Learn Compact](https://github.com/Olanetsoft/learn-compact).

**Live API:** https://compact-playground.onrender.com

## API

### POST /compile

```bash
curl -X POST https://compact-playground.onrender.com/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }"}'
```

**Response:**
```json
{
  "success": true,
  "output": "Compilation successful",
  "executionTime": 3360
}
```

**Error Response:**
```json
{
  "success": false,
  "errors": [{"line": 5, "column": 12, "message": "unbound identifier Void"}]
}
```

### GET /health

```bash
curl https://compact-playground.onrender.com/health
```

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

## Deploy

### Render.com

1. Fork this repo
2. Create Web Service on [render.com](https://render.com)
3. Connect repo, select Docker runtime
4. Deploy

### Docker

```bash
docker build -t compact-playground .
docker run -p 8080:8080 compact-playground
```

## Development

```bash
npm install
npm run dev:node  # Requires compactc installed locally
npm run test:run  # Run tests
```

## License

MIT

