#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────

API="http://localhost:8080"
IMAGE="compact-playground-demo"
CONTAINER="compact-playground-demo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKIP_DOCKER=false

# ─── Parse Arguments ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      API="$2"
      shift 2
      ;;
    --skip-docker)
      SKIP_DOCKER=true
      shift
      ;;
    *)
      echo "Usage: $0 [--url <URL>] [--skip-docker]"
      exit 1
      ;;
  esac
done

# Colors
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────────

banner() {
  echo ""
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${CYAN}  $1${RESET}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"
  echo ""
}

section() {
  echo ""
  echo -e "${BOLD}${YELLOW}── $1 ──${RESET}"
  echo ""
}

describe() {
  echo -e "${DIM}$1${RESET}"
  echo ""
}

show_request() {
  echo -e "${BOLD}Request:${RESET}"
  echo -e "${GREEN}$1${RESET}"
  echo ""
}

pause() {
  echo -e "${DIM}Press Enter to continue...${RESET}"
  read -r
}

send_request() {
  echo -e "${BOLD}Response:${RESET}"
  eval "$1" 2>&1 | jq . 2>/dev/null || eval "$1" 2>&1
  echo ""
}

read_contract() {
  cat "$SCRIPT_DIR/contracts/$1"
}

# JSON-escape a file's contents
json_escape() {
  python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" < "$SCRIPT_DIR/contracts/$1"
}

cleanup() {
  if [ "$SKIP_DOCKER" = false ]; then
    echo ""
    echo -e "${DIM}Stopping container...${RESET}"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}

# ─── Startup ──────────────────────────────────────────────────────────────────

trap cleanup EXIT

banner "Compact Playground API Demo"

if [ "$SKIP_DOCKER" = true ]; then
  echo "Using server at $API (Docker skipped)"
  echo ""
  pause
else
  echo "This demo builds the Docker image, starts the playground, and walks"
  echo "through each API endpoint interactively."
  echo ""
  pause

  section "Building Docker image"
  docker build -t "$IMAGE" "$SCRIPT_DIR/.." 2>&1 | tail -5
  echo ""

  section "Starting container"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -p 8080:8080 "$IMAGE" >/dev/null

  echo "Waiting for server to be ready..."
  for i in $(seq 1 60); do
    if curl -sf "$API/health" >/dev/null 2>&1; then
      echo -e "${GREEN}Server is ready.${RESET}"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo -e "${RED}Server failed to start. Logs:${RESET}"
      docker logs "$CONTAINER"
      exit 1
    fi
    sleep 1
  done
  echo ""
  pause
fi

# ─── 1. Health Check ─────────────────────────────────────────────────────────

banner "1. Health Check"

describe "The /health endpoint reports server status, Compact CLI availability,
cache statistics, and OpenZeppelin dependency status."

show_request "GET /health"
pause
send_request "curl -s $API/health"
pause

# ─── 2. Installed Compiler Versions ──────────────────────────────────────────

banner "2. Installed Compiler Versions"

describe "The /versions endpoint lists all installed compiler versions, the default,
and what language version each compiler supports."

show_request "GET /versions"
pause
send_request "curl -s $API/versions"
pause

# ─── 3. Available Libraries ─────────────────────────────────────────────────

banner "3. Available Libraries"

describe "The /libraries endpoint lists OpenZeppelin Compact modules available for import.
Libraries are organized by domain: access, security, token, utils.
Note: Libraries are only available when OZ contracts are installed (Docker image)."

show_request "GET /libraries"
pause
send_request "curl -s $API/libraries"
pause

# ─── Contract: counter.compact ───────────────────────────────────────────────

section "Contract: counter.compact (used in demos 4-11)"

echo -e "${CYAN}$(read_contract counter.compact)${RESET}"
echo ""
CODE=$(json_escape counter.compact)
pause

# ─── 4. Compile — Default Version ────────────────────────────────────────────

banner "4. Compile — Default Version"

describe "POST /compile takes Compact source code and compiles it. When no version is
specified, the default compiler version is used."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE}'"

show_request "POST /compile  (counter.compact, default version)"
pause
send_request "$CMD"
pause

# ─── 5. Compile — Detect Version from Pragma ─────────────────────────────────

banner "5. Compile — Detect Version from Pragma"

describe "Use \"detect\" to auto-select the best compiler based on the pragma in the code.
The pragma 'language_version >= 0.21' will match compilers whose language version is >= 0.21.
Using the same counter.compact code from above."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"detect\"]}'"

show_request "POST /compile  (counter.compact, version: detect)"
pause
send_request "$CMD"
pause

# ─── 6. Compile — Latest Version ─────────────────────────────────────────────

banner "6. Compile — Latest + Specific Versions"

describe "Use \"latest\" alongside specific versions. Results show which actual compiler
was used for each request. Using the same counter.compact code from above."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"latest\", \"0.26.0\"]}'"

show_request "POST /compile  (counter.compact, versions: latest + 0.26.0)"
pause
send_request "$CMD"
pause

# ─── 7. Compile — Multiple Versions ──────────────────────────────────────────

banner "7. Compile — Multiple Versions"

describe "Pass multiple versions to compile against all of them in parallel.
Results are returned per version. 0.30.0 should succeed (language 0.22.0 satisfies
pragma >= 0.21), while older versions show expected mismatches.
Using the same counter.compact code from above."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"0.30.0\", \"0.29.0\", \"0.26.0\"]}'"

show_request "POST /compile  (counter.compact, versions 0.30.0 + 0.29.0 + 0.26.0)"
pause
send_request "$CMD"
pause

# ─── 8. Compile — Error with Detect ──────────────────────────────────────────

banner "8. Compile — Error with Detect"

describe "buggy.compact has a type error. Using \"detect\" picks the right compiler from the
pragma, so the error shown is the actual type error (not a version mismatch)."

echo -e "${DIM}Contract: buggy.compact${RESET}"
echo -e "${CYAN}$(read_contract buggy.compact)${RESET}"
echo ""

CODE=$(json_escape buggy.compact)
CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"detect\"]}'"

show_request "POST /compile  (buggy.compact — has a type error, version: detect)"
pause
send_request "$CMD"
pause

# ─── 9. Compile — with TypeScript Bindings ──────────────────────────────────

banner "9. Compile — TypeScript Bindings"

describe "Setting includeBindings: true forces full ZK compilation (overrides skipZk)
and returns TypeScript artifacts in the 'bindings' field. These are the types
and deployment helpers generated by the compiler.

Note: The zkir binary shipped with the Compact CLI is x86_64 only (no
aarch64-linux build exists). On ARM systems (e.g., Apple Silicon running
Docker), zkir can start under emulation but crashes with SIGILL (Illegal
Instruction) during proof key generation because the BLS12-381 assembly
in the blst cryptography library uses x86 instructions the emulator
cannot handle. This works correctly on native x86_64 hosts (e.g., Fly.io)."

CODE=$(json_escape counter.compact)
CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"options\": {\"includeBindings\": true}}'"

show_request "POST /compile  (counter.compact, includeBindings: true)"
pause
send_request "$CMD"
pause

# ─── 10. Compile — Compilation Insights ─────────────────────────────────────

banner "10. Compile — Compilation Insights"

describe "Successful compile responses include an 'insights' field with circuit
metadata extracted from the compiler output. No special option needed.

The insights field contains:
  - circuitCount: total circuits compiled
  - circuits[]: each circuit's name, k-value, and row count
  - usesZkProofs: whether any circuit uses ZK proofs

Note: Insights require full ZK compilation. When using --skip-zk (the default),
the compiler does not output circuit metadata. On ARM systems this will fail
due to the same zkir/blst limitation described in Section 9. To see insights,
compile with skipZk: false on a native x86_64 Linux host."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"options\": {\"skipZk\": false}}'"

show_request "POST /compile  (counter.compact, skipZk: false — insights appear with full ZK compilation)"
pause
send_request "$CMD"
pause

# ─── 11. Compile — with OZ Libraries ───────────────────────────────────────

banner "11. Compile — with OZ Libraries"

describe "The 'libraries' option links OpenZeppelin Compact modules into compilation.
Pass an array of \"domain/ModuleName\" strings matching entries from GET /libraries.

Note: OZ contracts are only available in the Docker image. Outside Docker,
this returns an informative error — which is expected."

echo -e "${DIM}Contract: oz-example.compact${RESET}"
echo -e "${CYAN}$(read_contract oz-example.compact)${RESET}"
echo ""

OZ_CODE=$(json_escape oz-example.compact)
CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $OZ_CODE, \"options\": {\"libraries\": [\"access/Ownable\"]}, \"versions\": [\"detect\"]}'"

show_request "POST /compile  (oz-example.compact, libraries: [\"access/Ownable\"])"
pause
send_request "$CMD"
pause

# ─── 12. Compile Archive — Multi-File Contract ──────────────────────────────

banner "12. Compile Archive — Multi-File Contract"

describe "POST /compile/archive accepts a .tar.gz archive containing multiple .compact files.
The compiler resolves imports relative to the entry point's directory.

This demo uses two contracts:
  - Vault.compact (entry point) — imports MathLib for arithmetic
  - MathLib.compact (library)   — provides add() and subtract() circuits"

echo -e "${DIM}Contract: archive/Vault.compact (entry point)${RESET}"
echo -e "${CYAN}$(read_contract archive/Vault.compact)${RESET}"
echo ""
echo -e "${DIM}Contract: archive/MathLib.compact (imported library)${RESET}"
echo -e "${CYAN}$(read_contract archive/MathLib.compact)${RESET}"
echo ""

# Create the .tar.gz archive from the demo contracts
ARCHIVE_TMP=$(mktemp /tmp/demo-archive-XXXXXX.tar.gz)
tar -czf "$ARCHIVE_TMP" -C "$SCRIPT_DIR/contracts/archive" Vault.compact MathLib.compact

CMD="curl -s $API/compile/archive -F archive=@$ARCHIVE_TMP -F entryPoint=Vault.compact"

show_request "POST /compile/archive  (Vault.compact + MathLib.compact archive)"
pause
send_request "$CMD"
rm -f "$ARCHIVE_TMP"
pause

# ─── 13. Compile Archive — With Options ─────────────────────────────────────

banner "13. Compile Archive — With Options"

describe "The archive endpoint accepts an optional JSON 'options' field.
Setting skipZk to false requests full ZK compilation (slower but complete)."

ARCHIVE_TMP=$(mktemp /tmp/demo-archive-XXXXXX.tar.gz)
tar -czf "$ARCHIVE_TMP" -C "$SCRIPT_DIR/contracts/archive" Vault.compact MathLib.compact

CMD="curl -s $API/compile/archive -F archive=@$ARCHIVE_TMP -F entryPoint=Vault.compact -F 'options={\"skipZk\": true}'"

show_request "POST /compile/archive  (with options: {\"skipZk\": true})"
pause
send_request "$CMD"
rm -f "$ARCHIVE_TMP"
pause

# ─── Contract: unformatted.compact ───────────────────────────────────────────

section "Contract: unformatted.compact (used in demos 14-15)"

echo -e "${CYAN}$(read_contract unformatted.compact)${RESET}"
echo ""
CODE=$(json_escape unformatted.compact)
pause

# ─── 14. Format — Default Version ───────────────────────────────────────────

banner "14. Format — Default Version"

describe "POST /format runs the Compact formatter on your code. It returns the
formatted output, whether anything changed, and a diff (always included when changed)."

CMD="curl -s $API/format -H 'Content-Type: application/json' -d '{\"code\": $CODE}'"

show_request "POST /format  (unformatted code, default version — diff always returned)"
pause
send_request "$CMD"
pause

# ─── 15. Format — Multiple Versions ─────────────────────────────────────────

banner "15. Format — Multiple Versions"

describe "Format with multiple compiler versions to compare formatting differences.
Using the same unformatted.compact code from above."

CMD="curl -s $API/format -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"latest\", \"0.26.0\"]}'"

show_request "POST /format  (unformatted code, versions: latest + 0.26.0)"
pause
send_request "$CMD"
pause

# ─── 16. Analyze — Fast Mode ────────────────────────────────────────────────

banner "16. Analyze — Fast Mode"

describe "POST /analyze runs a 5-stage analysis pipeline: parse → semantic model →
rules → recommendations → circuit explanations. Fast mode is source-level only
(no compilation). Returns summary, structure, findings, recommendations, and
per-circuit explanations with ZK implications and privacy considerations."

echo -e "${DIM}Contract: token.compact${RESET}"
echo -e "${CYAN}$(read_contract token.compact)${RESET}"
echo ""

CODE=$(json_escape token.compact)
CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"fast\"}'"

show_request "POST /analyze  (token.compact, fast mode — full canonical response)"
pause
send_request "$CMD"
pause

# ─── 17. Analyze — Filtered Sections ────────────────────────────────────────

banner "17. Analyze — Filtered Sections"

describe "Use the 'include' parameter to request only specific sections. Summary and
structure are always returned. Available sections: diagnostics, facts, findings,
recommendations, circuits, compilation."

CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"fast\", \"include\": [\"findings\", \"recommendations\"]}'"

show_request "POST /analyze  (token.compact, fast mode, include: findings + recommendations only)"
pause
send_request "$CMD"
pause

# ─── 18. Analyze — Single Circuit ───────────────────────────────────────────

banner "18. Analyze — Single Circuit"

describe "Use the 'circuit' parameter to focus the analysis on a specific circuit.
Returns explanation, facts, and findings for just that circuit."

CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"fast\", \"circuit\": \"transfer\"}'"

show_request "POST /analyze  (token.compact, fast mode, circuit: transfer)"
pause
send_request "$CMD"
pause

# ─── 19. Analyze — Deep Mode with Detect ────────────────────────────────────

banner "19. Analyze — Deep Mode (Detect Version)"

describe "Deep mode adds compilation to the analysis pipeline. The compiler validates
your code and returns diagnostics. Using \"detect\" picks the right compiler from
the pragma. The response includes both analysis results and compilation results."

CODE=$(json_escape counter.compact)
CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"deep\", \"versions\": [\"detect\"]}'"

show_request "POST /analyze  (counter.compact, deep mode, version: detect)"
pause
send_request "$CMD"
pause

# ─── 20. Analyze — Deep Mode, Multiple Versions ─────────────────────────────

banner "20. Analyze — Deep Mode (Multiple Versions)"

describe "Deep analysis across multiple compiler versions shows which versions
successfully compile the code. Each version gets its own compilation result."

CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"deep\", \"versions\": [\"0.30.0\", \"0.29.0\", \"0.26.0\"]}'"

show_request "POST /analyze  (counter.compact, deep mode, versions 0.30.0 + 0.29.0 + 0.26.0)"
pause
send_request "$CMD"
pause

# ─── 21. Visualize — Contract Architecture Graph ────────────────────────────

banner "21. Visualize — Contract Architecture Graph"

describe "POST /visualize generates a directed graph of your contract's architecture.
It returns:
  - nodes: circuits, ledger fields, and witnesses with metadata
  - edges: reads, writes, and uses_witness relationships
  - groups: public vs private privacy groupings
  - mermaid: a Mermaid diagram string you can render"

CODE=$(json_escape token.compact)
CMD="curl -s $API/visualize -H 'Content-Type: application/json' -d '{\"code\": $CODE}'"

show_request "POST /visualize  (token.compact)"
pause
send_request "$CMD"
pause

# ─── 22. Prove — ZK Privacy Boundary Analysis ───────────────────────────────

banner "22. Prove — ZK Privacy Boundary Analysis"

describe "POST /prove analyzes the zero-knowledge privacy boundaries of your contract.
For each circuit it returns:
  - proverKnows: what the prover (transaction sender) knows
  - verifierSees: what the verifier (blockchain) can see
  - constraints: assert() and cryptographic constraints
  - privacyBoundary: items that cross the prover/verifier boundary
  - proofFlow: step-by-step proof generation and verification
  - narrative: human-readable explanation of the circuit's privacy model"

CMD="curl -s $API/prove -H 'Content-Type: application/json' -d '{\"code\": $CODE}'"

show_request "POST /prove  (token.compact — all circuits)"
pause
send_request "$CMD"
pause

# ─── 23. Prove — Single Circuit ─────────────────────────────────────────────

banner "23. Prove — Single Circuit"

describe "Use the 'circuit' parameter to focus the proof analysis on a specific circuit.
The 'transfer' circuit is interesting because it has an assert() constraint and
modifies both public and private state."

CMD="curl -s $API/prove -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"circuit\": \"transfer\"}'"

show_request "POST /prove  (token.compact, circuit: transfer)"
pause
send_request "$CMD"
pause

# ─── 24. Diff ────────────────────────────────────────────────────────────────

banner "24. Semantic Contract Diff"

describe "POST /diff compares two contract versions and reports structural changes:
added/removed/modified circuits, ledger fields, imports, and pragma."

echo -e "${DIM}Comparing: token.compact -> token-v2.compact${RESET}"
echo ""
echo -e "${YELLOW}Changes in v2:${RESET}"
echo "  + Added 'owner' ledger field"
echo "  + Added 'burn' circuit"
echo "  + Added 'getTotalSupply' circuit"
echo ""

BEFORE=$(json_escape token.compact)
AFTER=$(json_escape token-v2.compact)
CMD="curl -s $API/diff -H 'Content-Type: application/json' -d '{\"before\": $BEFORE, \"after\": $AFTER}'"

show_request "POST /diff  (token.compact vs token-v2.compact)"
pause
send_request "$CMD"
pause

# ─── 25. Cached Response ────────────────────────────────────────────────────

banner "25. Cached Response Lookup"

describe "Most endpoints include a 'cacheKey' field in their response — an opaque
cache token. You can retrieve any cached result later via
GET /cached-response/:hash without re-running the operation.

Let's compile a contract and then look up the result by its cacheKey."

CODE=$(json_escape counter.compact)
COMPILE_RESPONSE=$(curl -s "$API/compile" -H 'Content-Type: application/json' \
  -d "{\"code\": $CODE}") || true

echo -e "${BOLD}Step 1: Compile request${RESET}"
echo "$COMPILE_RESPONSE" | jq . 2>/dev/null || echo "$COMPILE_RESPONSE"
echo ""

CACHE_KEY=$(echo "$COMPILE_RESPONSE" | jq -r '.cacheKey // empty' 2>/dev/null) || true

if [ -z "$CACHE_KEY" ]; then
  echo -e "${DIM}No cacheKey in response (caching may be disabled). Skipping cache lookup.${RESET}"
  pause
else
  echo -e "${DIM}Captured cacheKey: $CACHE_KEY${RESET}"
  echo ""
  pause

  CMD="curl -s $API/cached-response/$CACHE_KEY"

  echo -e "${BOLD}Step 2: Retrieve cached result${RESET}"
  show_request "GET /cached-response/$CACHE_KEY"
  pause
  send_request "$CMD"
  pause
fi

# ─── 26. Root ────────────────────────────────────────────────────────────────

banner "26. API Index"

describe "The root endpoint lists all available endpoints."

show_request "GET /"
pause
send_request "curl -s $API/"
pause

# ─── Done ─────────────────────────────────────────────────────────────────────

banner "Demo Complete"

echo "Endpoints demonstrated:"
echo "  GET  /health                  - Service health check + OZ dependency status"
echo "  GET  /versions                - Installed compiler versions"
echo "  GET  /libraries               - Available OZ Compact modules"
echo "  POST /compile                 - Compile Compact code (detect / latest / multi-version)"
echo "  POST /compile/archive         - Compile multi-file .tar.gz archives"
echo "  POST /format                  - Format Compact code"
echo "  POST /analyze                 - 5-stage analysis pipeline (fast / deep)"
echo "  POST /visualize               - Contract architecture graph (DAG + Mermaid)"
echo "  POST /prove                   - ZK privacy boundary analysis"
echo "  POST /diff                    - Semantic contract diff"
echo "  GET  /cached-response/:hash   - Retrieve cached result by opaque token"
echo "  GET  /                        - API index"
echo ""
echo "Compile features:"
echo "  includeBindings: true  - Full ZK compilation + TypeScript artifacts"
echo "  insights               - Circuit metadata (k-values, row counts) — always included"
echo "  libraries: [...]       - Link OZ Compact modules (Docker only)"
echo ""
echo "Analyze features:"
echo "  mode: fast      - Source-level analysis (no compilation)"
echo "  mode: deep      - Analysis + compilation diagnostics"
echo "  include: [...]  - Filter response sections (findings, recommendations, etc.)"
echo "  circuit: name   - Focus analysis on a single circuit"
echo ""
echo "Special version values:"
echo "  \"detect\" - Auto-select compiler based on pragma in source code"
echo "  \"latest\" - Use the newest installed compiler"
echo ""
echo "Caching:"
echo "  Responses from compile, format, diff, analyze, and prove include a cacheKey."
echo "  Use GET /cached-response/:hash to retrieve any cached result."
echo ""
if [ "$SKIP_DOCKER" = false ]; then
  echo "The container will be stopped automatically."
fi
echo ""
