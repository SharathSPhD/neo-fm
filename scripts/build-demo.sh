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
    echo "[build-demo] $DEMO: not yet implemented — fill in when the phase ships"
    exit 1
    ;;
  *)
    echo "::error::unknown demo: $DEMO" >&2
    exit 2
    ;;
esac
