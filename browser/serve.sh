#!/usr/bin/env bash
# Simple development server for the browser playground.
# Serves files with correct MIME types for WASM and ES modules.
set -euo pipefail

PORT="${1:-8000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Serving Compact Playground at http://localhost:${PORT}"
echo "  Browser UI:  ${DIR}/browser/"
echo "  WASM module: ${DIR}/wasm-compiler/pkg/"
echo ""
echo "Press Ctrl+C to stop."

cd "$DIR"
python3 -m http.server "$PORT" 2>/dev/null || npx serve -l "$PORT" .
