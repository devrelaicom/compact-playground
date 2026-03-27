#!/usr/bin/env bash
# Build the Compact WASM compiler module.
# Prerequisites: rustup, wasm-pack
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Running tests..."
cargo test

echo ""
echo "==> Building WASM (release, web target)..."
wasm-pack build --target web --release

echo ""
echo "==> Build complete!"
ls -lh pkg/compact_wasm_compiler_bg.wasm
echo ""
echo "WASM module ready at: ${SCRIPT_DIR}/pkg/"
