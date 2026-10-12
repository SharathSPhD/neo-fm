#!/bin/bash
# Installs dependencies so lint/typecheck/tests work in Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# TypeScript monorepo (web app + packages). Prefer install over ci so the cached container is reused.
pnpm install --frozen-lockfile=false

# Python deps for the PCE engine + embedder auth tests (mirrors the pce-engine CI job).
python3 -m pip install --quiet numpy scipy pytest -r services/embedder/requirements.txt
