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
  phase-2)
    echo "[build-demo] phase-2: regenerating golden request + POSTing to /v1/generate"
    pnpm --filter @neo-fm/co-composer --silent build-phase-2-request
    if ! git diff --exit-code -- demos/phase-2-request.golden.json; then
      echo "::error::demos/phase-2-request.golden.json drifted; commit the regenerated file before reproducing the demo."
      exit 1
    fi
    : "${MUSIC_INFERENCE_URL:=http://localhost:8000}"
    : "${MUSIC_INFERENCE_HMAC_SECRET:?MUSIC_INFERENCE_HMAC_SECRET must be set; see infra/.env.dgx}"
    OUT_WAV=demos/phase-2.wav
    REQUEST_BODY="$(cat demos/phase-2-request.golden.json)"
    TS="$(date +%s)"
    SIG="$(printf '%s\n%s' "$REQUEST_BODY" "$TS" | openssl dgst -sha256 -hmac "$MUSIC_INFERENCE_HMAC_SECRET" | awk '{print $2}')"
    HTTP_STATUS="$(curl -s -o /tmp/phase-2.json -w '%{http_code}' \
      -H 'content-type: application/json' \
      -H "x-neofm-timestamp: $TS" \
      -H "x-neofm-signature: $SIG" \
      -H 'x-neofm-trace-id: phase-2-demo' \
      --data "$REQUEST_BODY" "$MUSIC_INFERENCE_URL/v1/generate")"
    if [[ "$HTTP_STATUS" != "200" ]]; then
      echo "::error::POST /v1/generate returned $HTTP_STATUS; see /tmp/phase-2.json"
      exit 1
    fi
    COMBINED_PATH="$(jq -r '.combined_file_path // (.sections[0].file_path)' /tmp/phase-2.json)"
    docker cp "$(docker compose -f infra/docker-compose.dgx.yml ps -q music-inference):${COMBINED_PATH}" "$OUT_WAV"
    ffprobe -v error -show_entries format=duration "$OUT_WAV" || true
    echo "[build-demo] wrote $OUT_WAV"
    ;;
  phase-3)
    echo "[build-demo] phase-3: regenerating Kabir-doha golden request + POSTing to /v1/generate"
    pnpm --filter @neo-fm/lyrics --silent build-phase-3-request
    if ! git diff --exit-code -- demos/phase-3-request.golden.json; then
      echo "::error::demos/phase-3-request.golden.json drifted; commit the regenerated file before reproducing the demo."
      exit 1
    fi
    : "${MUSIC_INFERENCE_URL:=http://localhost:8000}"
    : "${MUSIC_INFERENCE_HMAC_SECRET:?MUSIC_INFERENCE_HMAC_SECRET must be set; see infra/.env.dgx}"
    OUT_WAV=demos/phase-3.wav
    REQUEST_BODY="$(cat demos/phase-3-request.golden.json)"
    TS="$(date +%s)"
    SIG="$(printf '%s\n%s' "$REQUEST_BODY" "$TS" | openssl dgst -sha256 -hmac "$MUSIC_INFERENCE_HMAC_SECRET" | awk '{print $2}')"
    HTTP_STATUS="$(curl -s -o /tmp/phase-3.json -w '%{http_code}' \
      -H 'content-type: application/json' \
      -H "x-neofm-timestamp: $TS" \
      -H "x-neofm-signature: $SIG" \
      -H 'x-neofm-trace-id: phase-3-demo' \
      --data "$REQUEST_BODY" "$MUSIC_INFERENCE_URL/v1/generate")"
    if [[ "$HTTP_STATUS" != "200" ]]; then
      echo "::error::POST /v1/generate returned $HTTP_STATUS; see /tmp/phase-3.json"
      exit 1
    fi
    COMBINED_PATH="$(jq -r '.combined_file_path // (.sections[0].file_path)' /tmp/phase-3.json)"
    docker cp "$(docker compose -f infra/docker-compose.dgx.yml ps -q music-inference):${COMBINED_PATH}" "$OUT_WAV"
    ffprobe -v error -show_entries format=duration "$OUT_WAV" || true
    echo "[build-demo] wrote $OUT_WAV"
    ;;
  *)
    echo "::error::unknown demo: $DEMO" >&2
    exit 2
    ;;
esac
