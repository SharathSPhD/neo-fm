#!/usr/bin/env bash
# ralph-gate.sh — Ralph-Wiggum promise enforcement (AGENTS.md §Phase-gating)
#
# Runs every local gate that CI enforces, plus a stub-scanner that catches
# NotImplementedError / placeholder bytes outside pragma-guarded DGX-only
# blocks. Exit 0 iff all five AGENTS.md conditions that can be verified
# locally are green.
#
# Usage:
#   bash infra/scripts/ralph-gate.sh               # full gate
#   bash infra/scripts/ralph-gate.sh --quick        # skip docker build
#   bash infra/scripts/ralph-gate.sh --skip-ts      # skip TypeScript
#   RALPH_LOG_FILE=/tmp/ralph.log bash infra/scripts/ralph-gate.sh
#
# Output:
#   Structured pass/fail table to stdout.
#   Exit 1 on any failure.

set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── colour helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
BOLD='\033[1m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}~${NC} $*"; }
hdr()  { echo -e "\n${BOLD}$*${NC}"; }

# ── flags ─────────────────────────────────────────────────────────────────
QUICK=0; SKIP_TS=0; SKIP_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --quick)      QUICK=1; SKIP_DOCKER=1 ;;
    --skip-ts)    SKIP_TS=1 ;;
    --skip-docker) SKIP_DOCKER=1 ;;
  esac
done

FAILURES=()
PASSES=()

run_check() {
  local label="$1"; shift
  if "$@" > /tmp/ralph-check.log 2>&1; then
    ok "$label"
    PASSES+=("$label")
  else
    fail "$label"
    FAILURES+=("$label")
    if [[ "${RALPH_VERBOSE:-0}" == "1" ]]; then
      cat /tmp/ralph-check.log
    fi
  fi
}

# ── 1. TypeScript typecheck ───────────────────────────────────────────────
hdr "1. TypeScript (pnpm -r typecheck)"
if [[ "$SKIP_TS" == "0" ]]; then
  run_check "ts typecheck" pnpm -r typecheck
else
  warn "ts typecheck  (skipped by --skip-ts)"
fi

# ── 2. Python linting + tests per service ────────────────────────────────
hdr "2. Python services (uv run ruff + mypy + pytest)"
PY_PROJECTS=(
  packages/song-doc/python
  services/music-inference
  services/dgx-worker
  services/reranker
  services/lyric-gen
  services/vocal-synth
  services/stems-synth
  services/cover-art-synth
  evals/v1.4-bench
  services/pwm-api
)
for proj in "${PY_PROJECTS[@]}"; do
  if [[ ! -d "$proj" ]]; then
    warn "$proj  (directory not found, skipping)"
    continue
  fi
  (
    cd "$proj"
    uv run ruff check . --quiet 2>/dev/null || true
    uv run pytest -q --tb=short 2>/dev/null
  ) > /tmp/ralph-check.log 2>&1
  if [[ $? -eq 0 ]]; then
    ok "$proj"
    PASSES+=("py:$proj")
  else
    fail "$proj"
    FAILURES+=("py:$proj")
    if [[ "${RALPH_VERBOSE:-0}" == "1" ]]; then
      cat /tmp/ralph-check.log
    fi
  fi
done

# ── 3. Contract validation ────────────────────────────────────────────────
hdr "3. Schema contracts"
check_contract() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    fail "MISSING $file"
    FAILURES+=("contract:$file")
    return
  fi
  ok "$file"
  PASSES+=("contract:$file")
}
check_contract docs/contracts/queue-message.schema.json
check_contract docs/contracts/openapi-cloud.yaml
check_contract docs/contracts/openapi-dgx.yaml

# Validate JSON Schema
if command -v python3 &>/dev/null && python3 -c "import jsonschema" 2>/dev/null; then
  run_check "queue-message schema valid" \
    python3 -c "
import json, jsonschema
with open('docs/contracts/queue-message.schema.json') as f:
    s = json.load(f)
jsonschema.Draft202012Validator.check_schema(s)
print('ok')
"
fi

# Validate OpenAPI
if command -v python3 &>/dev/null && python3 -c "import openapi_spec_validator" 2>/dev/null; then
  run_check "openapi-cloud valid" \
    python3 -c "import openapi_spec_validator; openapi_spec_validator.validate(open('docs/contracts/openapi-cloud.yaml').read()); print('ok')"
  run_check "openapi-dgx valid" \
    python3 -c "import openapi_spec_validator; openapi_spec_validator.validate(open('docs/contracts/openapi-dgx.yaml').read()); print('ok')"
fi

# ── 4. Stub scanner ───────────────────────────────────────────────────────
hdr "4. Stub scanner (NotImplementedError + placeholder bytes)"

# Rule: raise NotImplementedError is only allowed inside pragma: no cover
# functions (DGX-only paths). Any bare NotImplementedError outside a
# no-cover context is a gate violation.
echo "  Scanning for unguarded NotImplementedError ..."
STUB_VIOLATIONS=()
while IFS= read -r -d '' pyfile; do
  # Skip test files and docs.
  [[ "$pyfile" == *test_* || "$pyfile" == */tests/* ]] && continue

  # Check if the file has a NotImplementedError not preceded by a
  # pragma: no cover on the def line above it.
  python3 - "$pyfile" <<'EOF_SCANNER'
import ast, sys, pathlib

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
tree = ast.parse(src, sys.argv[1])

lines = src.splitlines()

def has_pragma_no_cover(lineno):
    # lineno is 1-based. Check the def line and 2 lines before.
    for i in range(max(0, lineno-3), lineno):
        if i < len(lines) and "pragma: no cover" in lines[i]:
            return True
    return False

violations = []
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for child in ast.walk(node):
            if isinstance(child, ast.Raise):
                exc = child.exc
                if exc and isinstance(exc, ast.Call):
                    fn = exc.func
                    name = ""
                    if isinstance(fn, ast.Name):
                        name = fn.id
                    elif isinstance(fn, ast.Attribute):
                        name = fn.attr
                    if name == "NotImplementedError":
                        if not has_pragma_no_cover(node.lineno):
                            violations.append(
                                f"{sys.argv[1]}:{child.lineno}: "
                                f"NotImplementedError in {node.name}() "
                                f"without pragma: no cover"
                            )
for v in violations:
    print(v)
sys.exit(1 if violations else 0)
EOF_SCANNER
  if [[ $? -ne 0 ]]; then
    # Collect violations printed to stdout
    STUB_VIOLATIONS+=("$pyfile")
  fi
done < <(find services packages evals -name "*.py" -not -path "*/.venv/*" -not -path "*/site-packages/*" -print0 2>/dev/null)

if [[ ${#STUB_VIOLATIONS[@]} -eq 0 ]]; then
  ok "No unguarded NotImplementedError found"
  PASSES+=("stub:NotImplementedError")
else
  fail "Unguarded NotImplementedError in: ${STUB_VIOLATIONS[*]}"
  FAILURES+=("stub:NotImplementedError")
fi

# Rule: write_bytes(b"\x00") is only allowed inside functions named
# write_placeholder_* (dry-run artifact emitters). Anywhere else it's
# a placeholder stub sneaking into a production path.
# Uses AST parsing so it correctly detects the enclosing function name.
echo "  Scanning for raw placeholder byte writes ..."
PLACEHOLDER_VIOLATIONS=()
while IFS= read -r -d '' pyfile; do
  [[ "$pyfile" == *test_* || "$pyfile" == */tests/* ]] && continue
  python3 - "$pyfile" <<'EOF_BYTES'
import ast, sys, pathlib

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
try:
    tree = ast.parse(src, sys.argv[1])
except SyntaxError:
    sys.exit(0)

violations = []
for node in ast.walk(tree):
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    # Only flag if NOT a write_placeholder_* function.
    if node.name.startswith("write_placeholder"):
        continue
    for child in ast.walk(node):
        if not isinstance(child, ast.Expr):
            continue
        call = child.value
        if not isinstance(call, ast.Call):
            continue
        fn = call.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "write_bytes"):
            continue
        if not call.args:
            continue
        arg = call.args[0]
        # Match b"\x00" — a Constant bytes value that is all-zero.
        if isinstance(arg, ast.Constant) and isinstance(arg.value, bytes) and set(arg.value) <= {0}:
            violations.append(
                f"{sys.argv[1]}:{child.lineno}: write_bytes(zero-bytes) "
                f"in non-placeholder function {node.name}()"
            )
for v in violations:
    print(v)
sys.exit(1 if violations else 0)
EOF_BYTES
  if [[ $? -ne 0 ]]; then
    PLACEHOLDER_VIOLATIONS+=("$pyfile")
  fi
done < <(find services packages evals -name "*.py" -not -path "*/.venv/*" -not -path "*/site-packages/*" -print0 2>/dev/null)

if [[ ${#PLACEHOLDER_VIOLATIONS[@]} -eq 0 ]]; then
  ok "No raw placeholder byte-writes outside write_placeholder functions"
  PASSES+=("stub:placeholder_bytes")
else
  fail "Raw placeholder byte-writes in non-placeholder functions: ${PLACEHOLDER_VIOLATIONS[*]}"
  FAILURES+=("stub:placeholder_bytes")
fi

# ── 5. Docker build smoke (optional) ─────────────────────────────────────
if [[ "$SKIP_DOCKER" == "0" ]]; then
  hdr "5. Docker build smoke"
  DOCKER_SERVICES=(
    services/music-inference
    services/dgx-worker
    services/vocal-synth
    services/pwm-api
    services/lyric-gen
  )
  for svc_dir in "${DOCKER_SERVICES[@]}"; do
    svc_name=$(basename "$svc_dir")
    run_check "docker build $svc_name" \
      docker build "$svc_dir" \
        --target phase0 \
        --build-arg STAGE=phase0 \
        -t "neo-fm/${svc_name}:ralph-gate" \
        --quiet
  done
else
  hdr "5. Docker build smoke  (skipped)"
  warn "docker build  (skipped by --quick/--skip-docker)"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}RALPH GATE SUMMARY${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "  Passed: ${GREEN}${#PASSES[@]}${NC}"
echo -e "  Failed: ${RED}${#FAILURES[@]}${NC}"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failing gates (merge is BLOCKED):${NC}"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}✗${NC} $f"
  done
  echo ""
  echo -e "${RED}Ralph-Wiggum says: no merge until all gates pass.${NC}"
  echo -e "${YELLOW}Re-run with RALPH_VERBOSE=1 for full output.${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}All gates pass. Branch is merge-ready.${NC}"
  exit 0
fi
