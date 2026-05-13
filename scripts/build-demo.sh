#!/usr/bin/env bash
# build-demo.sh — reproduce a phase-N demo artifact from the current checkout.
#
# The Ralph-Wiggum gate (AGENTS.md §Phase gating) requires that every demo be
# reproducible from the merged SHA. This script is the canonical reproduction
# entry point: it picks the right tooling for the named demo and re-runs it.
#
# Usage:
#   scripts/build-demo.sh phase-0
#   scripts/build-demo.sh phase-1
#   scripts/build-demo.sh phase-2
#   scripts/build-demo.sh phase-3
#
# Each phase has a different mode:
#   phase-0: capture nvidia-smi, docker --version, tailscale status into
#            demos/phase-0-dgx.txt + take a fresh repo snapshot.
#   phase-1: run dgx-smoke.sh with PHASE=1 to produce demos/phase-1.wav.
#   phase-2: golden e2e — codegen + co-composer + POST /v1/generate.
#   phase-3: render Kabir doha through PublicLyricsLibraryProvider.
#
# Exit codes:
#   0 — demo built and matches committed artifact (when applicable)
#   1 — failure
#   2 — unknown demo name

set -euo pipefail

DEMO="${1:-}"
if [[ -z "$DEMO" ]]; then
  echo "usage: $0 <phase-N>" >&2
  exit 2
fi

mkdir -p demos

case "$DEMO" in
  phase-0)
    echo "[build-demo] phase-0: capturing DGX runtime snapshot"
    {
      echo "=== nvidia-smi ==="
      nvidia-smi 2>&1 || echo "(no nvidia-smi on this host)"
      echo
      echo "=== docker --version ==="
      docker --version 2>&1 || echo "(docker missing)"
      echo
      echo "=== tailscale status ==="
      tailscale status 2>&1 || echo "(tailscale not installed)"
      echo
      echo "=== uname -a ==="
      uname -a
    } > demos/phase-0-dgx.txt
    echo "[build-demo] demos/phase-0-dgx.txt updated"
    ;;
  phase-1)
    echo "[build-demo] phase-1: running dgx-smoke.sh with PHASE=1"
    CURRENT_PHASE=1 bash scripts/dgx-smoke.sh 1
    ;;
  phase-2|phase-3)
    # The Phase 2 + Phase 3 golden requests are produced offline by
    # the co-composer / lyrics packages and committed to
    # demos/phase-{2,3}-request.golden.json. We regenerate them here
    # to fail-fast on drift, then forward to dgx-smoke.sh.
    PHASE_N="${DEMO#phase-}"
    case "$PHASE_N" in
      2)
        echo "[build-demo] phase-2: regenerating $DEMO golden request"
        pnpm --filter @neo-fm/co-composer build-phase-2-request >/dev/null
        ;;
      3)
        echo "[build-demo] phase-3: regenerating $DEMO golden request"
        pnpm --filter @neo-fm/lyrics build-phase-3-request >/dev/null
        ;;
    esac
    if ! git diff --quiet -- "demos/phase-${PHASE_N}-request.golden.json"; then
      echo "::error::demos/phase-${PHASE_N}-request.golden.json drifted vs the checked-in golden" >&2
      git --no-pager diff -- "demos/phase-${PHASE_N}-request.golden.json" >&2
      exit 1
    fi
    echo "[build-demo] $DEMO: running dgx-smoke.sh with PHASE=$PHASE_N"
    CURRENT_PHASE="$PHASE_N" bash scripts/dgx-smoke.sh "$PHASE_N"
    ;;
  *)
    echo "::error::unknown demo: $DEMO" >&2
    exit 2
    ;;
esac
