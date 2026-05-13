#!/usr/bin/env bash
# dgx-smoke.sh — verify the DGX-side stack is up and the music-inference
# container produces real output for one canned request.
#
# Runs on the DGX host (or a host that can reach the docker-compose network).
# Phase 0 builds the stub container and exercises /healthz only — /v1/generate
# is expected to return 501 with the stub error body.
#
# Phase 1 takes over and produces demos/phase-1.wav.
#
# Usage:
#   scripts/dgx-smoke.sh [phase]
# Default phase: detected from CURRENT_PHASE env, else "0".
#
# Exit codes:
#   0 — smoke passed
#   1 — healthcheck failed
#   2 — generate failed in an unexpected way
#   3 — required tool missing

set -euo pipefail

PHASE="${1:-${CURRENT_PHASE:-0}}"
COMPOSE_FILE="infra/docker-compose.dgx.yml"
ENV_FILE="infra/.env.dgx"
BASE_URL="${MUSIC_INFERENCE_URL:-http://localhost:8000}"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "::error::missing required tool: $1" >&2
    exit 3
  fi
}

require docker
require jq
require curl

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
::error::$ENV_FILE not found

Copy infra/.env.dgx.example to infra/.env.dgx and fill in
MUSIC_INFERENCE_HMAC_SECRET (see ADR 0003).
EOF
  exit 3
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
if [[ -z "${MUSIC_INFERENCE_HMAC_SECRET:-}" ]]; then
  echo "::error::MUSIC_INFERENCE_HMAC_SECRET unset in $ENV_FILE" >&2
  exit 3
fi

echo "[smoke] phase=$PHASE"
echo "[smoke] bringing up compose stack…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build music-inference dgx-worker

mkdir -p demos
BRINGUP_LOG="demos/phase-${PHASE}-bringup.txt"
{
  echo "=== docker ps ==="
  docker compose -f "$COMPOSE_FILE" ps
  echo
  echo "=== nvidia-smi ==="
  nvidia-smi 2>&1 || echo "(no nvidia-smi available on this host)"
} > "$BRINGUP_LOG"

echo "[smoke] waiting for /healthz to report ok…"
for _ in $(seq 1 30); do
  if curl -sSf "$BASE_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

HEALTH="$(curl -sS "$BASE_URL/healthz")"
echo "[smoke] healthz: $HEALTH"
STATUS="$(echo "$HEALTH" | jq -r .status)"
if [[ "$STATUS" != "ok" ]]; then
  echo "::error::/healthz returned status=$STATUS" >&2
  exit 1
fi

if [[ "$PHASE" == "0" ]]; then
  echo "[smoke] phase 0: confirming /v1/generate returns 501 with HMAC"
  BODY='{"job_id":"00000000-0000-0000-0000-000000000000","style_family":"western","sections":[{"id":"s1","type":"intro","target_seconds":30,"lyrics":"smoke test","language":"en"}]}'
  TS="$(date +%s)"
  SIG="$(printf '%s\n%s' "$BODY" "$TS" | openssl dgst -sha256 -hmac "$MUSIC_INFERENCE_HMAC_SECRET" -hex | awk '{print $2}')"
  CODE="$(curl -sS -o /tmp/gen.json -w '%{http_code}' \
    -H 'content-type: application/json' \
    -H "x-neofm-timestamp: $TS" \
    -H "x-neofm-signature: $SIG" \
    -d "$BODY" \
    "$BASE_URL/v1/generate")"
  if [[ "$CODE" != "501" ]]; then
    echo "::error::expected 501 from Phase-0 stub, got $CODE" >&2
    cat /tmp/gen.json >&2
    exit 2
  fi
  echo "[smoke] phase 0 stub responded 501 as expected. OK."
  exit 0
fi

smoke_generate() {
  # smoke_generate <phase> <body> <out-wav>
  # POST a signed request and stream the audio response straight to disk.
  local phase="$1" body="$2" out_wav="$3"
  local ts sig http_code content_type
  ts="$(date +%s)"
  sig="$(
    {
      printf '%s' "$body"
      printf '\n%s' "$ts"
    } | openssl dgst -sha256 -hmac "$MUSIC_INFERENCE_HMAC_SECRET" -hex | awk '{print $2}'
  )"
  http_code="$(curl -sS \
    -o "$out_wav" \
    -D /tmp/gen-headers.txt \
    -w '%{http_code}' \
    -H 'content-type: application/json' \
    -H "x-neofm-timestamp: $ts" \
    -H "x-neofm-signature: $sig" \
    -d "$body" \
    "$BASE_URL/v1/generate")"
  content_type="$(awk -F': ' 'tolower($1)=="content-type" {sub(/\r$/, "", $2); print $2}' /tmp/gen-headers.txt | tail -n1)"
  if [[ "$http_code" != "200" ]]; then
    echo "::error::expected 200 from /v1/generate, got $http_code" >&2
    if [[ "${content_type:-}" == application/json* ]]; then
      cat "$out_wav" >&2
    fi
    return 2
  fi
  case "${content_type:-}" in
    audio/wav|audio/x-wav|audio/mpeg|audio/flac) ;;
    *)
      echo "::error::unexpected content-type: $content_type" >&2
      return 2
      ;;
  esac
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$out_wav" \
    | tee -a "$BRINGUP_LOG"
  echo "[smoke] phase $phase WAV at $out_wav"
}

if [[ "$PHASE" == "1" ]]; then
  echo "[smoke] phase 1: requesting a real 30s WAV"
  BODY='{"job_id":"00000000-0000-0000-0000-000000000001","style_family":"western","target_duration_seconds":30,"sections":[{"id":"s1","type":"intro","target_seconds":30,"lyrics":"smoke test","language":"en","tags":["pop","major","bright"]}]}'
  smoke_generate 1 "$BODY" demos/phase-1.wav
  exit $?
fi

if [[ "$PHASE" == "2" || "$PHASE" == "3" ]]; then
  GOLDEN="demos/phase-${PHASE}-request.golden.json"
  if [[ ! -f "$GOLDEN" ]]; then
    echo "::error::missing $GOLDEN -- did Phase $PHASE land on this branch?" >&2
    exit 3
  fi
  echo "[smoke] phase $PHASE: using $GOLDEN"
  BODY="$(jq -c . "$GOLDEN")"
  smoke_generate "$PHASE" "$BODY" "demos/phase-${PHASE}.wav"
  exit $?
fi

echo "[smoke] phase=$PHASE has no smoke logic yet"
exit 2
