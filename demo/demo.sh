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

describe "The /health endpoint reports server status and Compact CLI availability."

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

# ─── Contract: counter.compact ───────────────────────────────────────────────

section "Contract: counter.compact (used in demos 3–6)"

echo -e "${CYAN}$(read_contract counter.compact)${RESET}"
echo ""
CODE=$(json_escape counter.compact)
pause

# ─── 3. Compile — Default Version ────────────────────────────────────────────

banner "3. Compile — Default Version"

describe "POST /compile takes Compact source code and compiles it. When no version is
specified, the default compiler version is used."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE}'"

show_request "POST /compile  (counter.compact, default version)"
pause
send_request "$CMD"
pause

# ─── 4. Compile — Detect Version from Pragma ─────────────────────────────────

banner "4. Compile — Detect Version from Pragma"

describe "Use \"detect\" to auto-select the best compiler based on the pragma in the code.
The pragma 'language_version >= 0.21' will match compilers whose language version is >= 0.21.
Using the same counter.compact code from above."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"detect\"]}'"

show_request "POST /compile  (counter.compact, version: detect)"
pause
send_request "$CMD"
pause

# ─── 5. Compile — Latest Version ─────────────────────────────────────────────

banner "5. Compile — Latest + Specific Versions"

describe "Use \"latest\" alongside specific versions. Results show which actual compiler
was used for each request. Using the same counter.compact code from above."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"latest\", \"0.26.0\"]}'"

show_request "POST /compile  (counter.compact, versions: latest + 0.26.0)"
pause
send_request "$CMD"
pause

# ─── 6. Compile — Multiple Versions ──────────────────────────────────────────

banner "6. Compile — Multiple Versions"

describe "Pass multiple versions to compile against all of them in parallel.
Results are returned per version. 0.29.0 should succeed (language 0.21.0 satisfies
pragma >= 0.21), while older versions show expected mismatches.
Using the same counter.compact code from above."

CMD="curl -s $API/compile -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"0.29.0\", \"0.26.0\", \"0.24.0\"]}'"

show_request "POST /compile  (counter.compact, versions 0.29.0 + 0.26.0 + 0.24.0)"
pause
send_request "$CMD"
pause

# ─── 7. Compile — Error with Detect ──────────────────────────────────────────

banner "7. Compile — Error with Detect"

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

# ─── Contract: unformatted.compact ───────────────────────────────────────────

section "Contract: unformatted.compact (used in demos 8–9)"

echo -e "${CYAN}$(read_contract unformatted.compact)${RESET}"
echo ""
CODE=$(json_escape unformatted.compact)
pause

# ─── 8. Format — Default Version ─────────────────────────────────────────────

banner "8. Format — Default Version"

describe "POST /format runs the Compact formatter on your code. It returns the
formatted output, whether anything changed, and a diff (always included when changed)."

CMD="curl -s $API/format -H 'Content-Type: application/json' -d '{\"code\": $CODE}'"

show_request "POST /format  (unformatted code, default version — diff always returned)"
pause
send_request "$CMD"
pause

# ─── 9. Format — Multiple Versions ───────────────────────────────────────────

banner "9. Format — Multiple Versions"

describe "Format with multiple compiler versions to compare formatting differences.
Using the same unformatted.compact code from above."

CMD="curl -s $API/format -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"versions\": [\"latest\", \"0.26.0\"]}'"

show_request "POST /format  (unformatted code, versions: latest + 0.26.0)"
pause
send_request "$CMD"
pause

# ─── 10. Analyze — Fast Mode ─────────────────────────────────────────────────

banner "10. Analyze — Fast Mode"

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

# ─── 11. Analyze — Filtered Sections ─────────────────────────────────────────

banner "11. Analyze — Filtered Sections"

describe "Use the 'include' parameter to request only specific sections. Summary and
structure are always returned. Available sections: diagnostics, facts, findings,
recommendations, circuits, compilation."

CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"fast\", \"include\": [\"findings\", \"recommendations\"]}'"

show_request "POST /analyze  (token.compact, fast mode, include: findings + recommendations only)"
pause
send_request "$CMD"
pause

# ─── 12. Analyze — Single Circuit ────────────────────────────────────────────

banner "12. Analyze — Single Circuit"

describe "Use the 'circuit' parameter to focus the analysis on a specific circuit.
Returns explanation, facts, and findings for just that circuit."

CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"fast\", \"circuit\": \"transfer\"}'"

show_request "POST /analyze  (token.compact, fast mode, circuit: transfer)"
pause
send_request "$CMD"
pause

# ─── 13. Analyze — Deep Mode with Detect ─────────────────────────────────────

banner "13. Analyze — Deep Mode (Detect Version)"

describe "Deep mode adds compilation to the analysis pipeline. The compiler validates
your code and returns diagnostics. Using \"detect\" picks the right compiler from
the pragma. The response includes both analysis results and compilation results."

CODE=$(json_escape counter.compact)
CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"deep\", \"versions\": [\"detect\"]}'"

show_request "POST /analyze  (counter.compact, deep mode, version: detect)"
pause
send_request "$CMD"
pause

# ─── 14. Analyze — Deep Mode, Multiple Versions ──────────────────────────────

banner "14. Analyze — Deep Mode (Multiple Versions)"

describe "Deep analysis across multiple compiler versions shows which versions
successfully compile the code. Each version gets its own compilation result."

CMD="curl -s $API/analyze -H 'Content-Type: application/json' -d '{\"code\": $CODE, \"mode\": \"deep\", \"versions\": [\"0.29.0\", \"0.26.0\", \"0.24.0\"]}'"

show_request "POST /analyze  (counter.compact, deep mode, versions 0.29.0 + 0.26.0 + 0.24.0)"
pause
send_request "$CMD"
pause

# ─── 15. Diff ─────────────────────────────────────────────────────────────────

banner "15. Semantic Contract Diff"

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

# ─── 16. Root ─────────────────────────────────────────────────────────────────

banner "16. API Index"

describe "The root endpoint lists all available endpoints."

show_request "GET /"
pause
send_request "curl -s $API/"
pause

# ─── Done ─────────────────────────────────────────────────────────────────────

banner "Demo Complete"

echo "Endpoints demonstrated:"
echo "  GET  /health    - Service health check"
echo "  GET  /versions  - Installed compiler versions with language version mapping"
echo "  POST /compile   - Compile Compact code (detect / latest / specific / multi-version)"
echo "  POST /format    - Format Compact code (detect / latest / specific / multi-version)"
echo "  POST /analyze   - 5-stage analysis pipeline (fast / deep, multi-version)"
echo "  POST /diff      - Semantic contract diff"
echo "  GET  /          - API index"
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
if [ "$SKIP_DOCKER" = false ]; then
  echo "The container will be stopped automatically."
fi
echo ""
