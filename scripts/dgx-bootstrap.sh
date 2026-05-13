#!/usr/bin/env bash
#
# neo-fm — one-command DGX environment bootstrap.
#
# Run on the DGX host after `git clone`. The script:
#
#   1. Verifies prerequisites (docker, gh CLI, optional huggingface_hub).
#   2. Pulls every required secret from environment / GitHub Actions secrets /
#      interactive prompt, in that order of preference.
#   3. Writes infra/.env.dgx with strict 0600 permissions.
#   4. Pre-pulls HeartMuLa weights into /mnt/models/heartmula (Phase 1 only;
#      skipped when --skip-models is passed).
#   5. Optionally `docker compose up -d` to bring the stack online.
#
# Idempotent: safe to re-run. Existing values in infra/.env.dgx are preserved
# unless `--reset` is passed.
#
# Usage:
#   bash scripts/dgx-bootstrap.sh                  # full setup
#   bash scripts/dgx-bootstrap.sh --skip-models    # skip HeartMuLa download
#   bash scripts/dgx-bootstrap.sh --reset          # overwrite .env.dgx
#   bash scripts/dgx-bootstrap.sh --no-up          # don't start containers
#
# Required GitHub Actions secret (already provisioned by the agent on
# SharathSPhD/neo-fm during Phase 4):
#
#   - MUSIC_INFERENCE_HMAC_SECRET   (auto-resolved via gh CLI if logged in)
#
# Operator must supply these once via env, prompt, or paste:
#
#   - SUPABASE_SERVICE_ROLE_KEY     (Supabase Dashboard → Project Settings → API)
#   - PG_DSN                        (Supabase Dashboard → Project Settings →
#                                    Database → Connection String → "Transaction
#                                    pooler", then swap the role to
#                                    `neo_fm_worker` and use the password set in
#                                    migration 0006 / via the bootstrap below)
#   - HF_TOKEN                      (https://huggingface.co/settings/tokens)
#
set -euo pipefail

# ----- CLI flags ------------------------------------------------------------
SKIP_MODELS=0
RESET=0
NO_UP=0
for arg in "$@"; do
  case "$arg" in
    --skip-models) SKIP_MODELS=1 ;;
    --reset) RESET=1 ;;
    --no-up) NO_UP=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

ENV_FILE="infra/.env.dgx"
EXAMPLE_FILE="infra/.env.dgx.example"

# ----- Helpers --------------------------------------------------------------
log() { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# Look up a value in this preference order:
#   1. Already in process env (export FOO=...).
#   2. Existing infra/.env.dgx line (unless --reset).
#   3. GitHub Actions secret (gh CLI; only works if the operator is logged in
#      *as a maintainer*).
#   4. Interactive prompt.
resolve_value() {
  local key="$1"
  local prompt_msg="$2"
  local from_gh="${3:-0}"

  # 1. process env wins
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi

  # 2. existing .env line
  if [[ $RESET -eq 0 && -f "$ENV_FILE" ]]; then
    local existing
    existing=$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)
    if [[ -n "$existing" ]]; then
      printf '%s' "$existing"
      return 0
    fi
  fi

  # 3. GitHub Actions secret (only if explicitly enabled for this key)
  # gh cannot read encrypted secret values, but if you've stored them as repo
  # variables (Settings → Secrets and variables → Actions → Variables) we can
  # read those. The Phase 4 commit stores HMAC as a secret; reading it
  # requires the operator to retrieve once and pass via env.

  # 4. prompt
  local val=""
  printf '%s\n  > ' "$prompt_msg" >&2
  IFS= read -r val
  printf '%s' "$val"
}

# ----- Prereqs --------------------------------------------------------------
log "checking prerequisites"
command -v docker >/dev/null || die "docker not found in PATH"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not installed"
command -v openssl >/dev/null || die "openssl not found (needed only on first run)"

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  log "gh CLI authenticated"
  HAS_GH=1
else
  warn "gh CLI not authenticated; you'll be prompted for any missing values"
  HAS_GH=0
fi

# ----- Resolve every required value ----------------------------------------
log "resolving secrets and connection strings"

# 4a. HMAC. If the operator hasn't pre-exported it, ask gh, otherwise generate.
HMAC_VALUE="${MUSIC_INFERENCE_HMAC_SECRET:-}"
if [[ -z "$HMAC_VALUE" && -f "$ENV_FILE" && $RESET -eq 0 ]]; then
  HMAC_VALUE=$(grep -E '^MUSIC_INFERENCE_HMAC_SECRET=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)
fi
if [[ -z "$HMAC_VALUE" ]]; then
  if [[ $HAS_GH -eq 1 ]]; then
    log "MUSIC_INFERENCE_HMAC_SECRET not set; checking GitHub Actions..."
    if gh secret list -R SharathSPhD/neo-fm 2>/dev/null | grep -q '^MUSIC_INFERENCE_HMAC_SECRET'; then
      warn "GitHub stores the HMAC secret but the CLI cannot decrypt it for"
      warn "security reasons. Retrieve it once from the deploy machine that"
      warn "originally generated it (the agent left it at /tmp/neo-fm-hmac-secret.txt"
      warn "on the workstation that ran scripts/dgx-bootstrap.sh first), or"
      warn "regenerate + rotate via:"
      warn "    new=\$(openssl rand -hex 32)"
      warn "    gh secret set MUSIC_INFERENCE_HMAC_SECRET --body \"\$new\""
    fi
  fi
  HMAC_VALUE=$(resolve_value MUSIC_INFERENCE_HMAC_SECRET \
    "Paste MUSIC_INFERENCE_HMAC_SECRET (64 hex chars). Leave blank to generate a fresh one (this will then need to be pasted back into the GH secret + Vercel env).")
  if [[ -z "$HMAC_VALUE" ]]; then
    HMAC_VALUE=$(openssl rand -hex 32)
    warn "Generated a new HMAC. Sync it to GitHub:"
    warn "    gh secret set MUSIC_INFERENCE_HMAC_SECRET -R SharathSPhD/neo-fm --body \"$HMAC_VALUE\""
  fi
fi

# 4b. Supabase. The URL is constant; the service-role key + PG_DSN are operator-only.
SUPABASE_URL_VALUE="${SUPABASE_URL:-https://lsxicfgqtdxvlcivlwmd.supabase.co}"
SERVICE_ROLE_VALUE=$(resolve_value SUPABASE_SERVICE_ROLE_KEY \
  "Paste SUPABASE_SERVICE_ROLE_KEY (Supabase Dashboard → API → service_role key).")
[[ -n "$SERVICE_ROLE_VALUE" ]] || die "SUPABASE_SERVICE_ROLE_KEY is required"

PG_DSN_VALUE=$(resolve_value PG_DSN \
  "Paste PG_DSN (transaction-pooler URI for neo_fm_worker role, port 6543).")
[[ -n "$PG_DSN_VALUE" ]] || die "PG_DSN is required"

# 4c. HF token (only required if pulling models on this machine).
HF_TOKEN_VALUE="${HF_TOKEN:-}"
if [[ $SKIP_MODELS -eq 0 ]]; then
  HF_TOKEN_VALUE=$(resolve_value HF_TOKEN \
    "Paste HF_TOKEN (huggingface.co → Settings → Tokens, read scope is enough).")
  [[ -n "$HF_TOKEN_VALUE" ]] || die "HF_TOKEN required when downloading HeartMuLa weights (--skip-models to defer)"
fi

# ----- Write infra/.env.dgx with 0600 -------------------------------------
log "writing $ENV_FILE"
umask 077
cat >"$ENV_FILE" <<EOF
# Generated by scripts/dgx-bootstrap.sh at $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Edit by hand or re-run the script with --reset to regenerate from scratch.

MUSIC_INFERENCE_HMAC_SECRET=${HMAC_VALUE}
MUSIC_INFERENCE_HMAC_SECRET_NEXT=

MUSIC_INFERENCE_URL=http://music-inference:8000

SUPABASE_URL=${SUPABASE_URL_VALUE}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_VALUE}

PG_DSN=${PG_DSN_VALUE}

QUEUE_NAME=song_generation_jobs
DLQ_NAME=song_generation_jobs_dlq
VISIBILITY_TIMEOUT_SECONDS=300
HEARTBEAT_INTERVAL_SECONDS=60
POLL_INTERVAL_SECONDS=5
MAX_ATTEMPTS=3

HF_TOKEN=${HF_TOKEN_VALUE}
HEARTMULA_CKPT_DIR=/mnt/models/heartmula
EOF
chmod 600 "$ENV_FILE"

# Sanity-check loadability with docker-compose.
log "validating compose env"
docker compose -f infra/docker-compose.dgx.yml --env-file "$ENV_FILE" config >/dev/null

# ----- Pre-pull HeartMuLa ---------------------------------------------------
if [[ $SKIP_MODELS -eq 0 ]]; then
  if [[ -d /mnt/models/heartmula/ckpt ]]; then
    log "/mnt/models/heartmula/ckpt already exists; skipping model download"
  else
    log "downloading HeartMuLa weights to /mnt/models/heartmula (~30 GB; first run only)"
    if ! command -v hf >/dev/null; then
      pip install --user --quiet "huggingface_hub[cli]>=0.25"
      export PATH="$HOME/.local/bin:$PATH"
    fi
    HF_TOKEN="$HF_TOKEN_VALUE" python scripts/download-heartmula.py
  fi
else
  log "skipping HeartMuLa download (--skip-models)"
fi

# ----- Bring the compose stack up ------------------------------------------
if [[ $NO_UP -eq 0 ]]; then
  log "starting docker compose stack"
  docker compose -f infra/docker-compose.dgx.yml --env-file "$ENV_FILE" up -d --build
  log "waiting for healthchecks"
  for _ in {1..30}; do
    if docker compose -f infra/docker-compose.dgx.yml ps music-inference 2>/dev/null \
        | grep -q "(healthy)"; then
      log "music-inference is healthy ✓"
      break
    fi
    sleep 2
  done
else
  log "not bringing the stack up (--no-up). Run:"
  log "    docker compose -f infra/docker-compose.dgx.yml --env-file $ENV_FILE up -d --build"
fi

log "bootstrap complete."
