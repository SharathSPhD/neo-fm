#!/usr/bin/env bash
# Decides whether the web code at HEAD is a MAJOR release for mobile (docs/RELEASE-POLICY.md) and what the next mobile
# tag is. Prints key=value lines (major, reason, last_tag, next_tag, sha); the workflow appends them to $GITHUB_OUTPUT.
# Needs full history and tags. PR bodies are read through `gh` when GH_TOKEN and GH_REPO are set.
# Env: FORCE=1 treats any new commit as major; NEO_FM_BUMP=patch bumps the patch instead of the minor.
set -euo pipefail

HEAD_SHA="$(git rev-parse HEAD)"
LAST_TAG="$(git tag -l 'mobile-v*' --sort=-v:refname | head -1)"
if [ -z "$LAST_TAG" ]; then LAST_TAG="mobile-v0.0.0"; BASE=""; else BASE="$(git rev-list -n1 "$LAST_TAG")"; fi

IFS=. read -r MA MI PA <<<"${LAST_TAG#mobile-v}"
if [ "${NEO_FM_BUMP:-minor}" = "patch" ]; then NEXT="mobile-v$MA.$MI.$((PA + 1))"; else NEXT="mobile-v$MA.$((MI + 1)).0"; fi

emit() { echo "major=$1"; echo "reason=$2"; echo "last_tag=$LAST_TAG"; echo "next_tag=$NEXT"; echo "sha=$HEAD_SHA"; }

if [ "$BASE" = "$HEAD_SHA" ] && [ "${FORCE:-0}" != "1" ]; then emit false "nothing new since $LAST_TAG"; exit 0; fi
RANGE="${BASE:+$BASE..}HEAD"

reasons=()
if [ -n "$(git diff --name-only $RANGE -- infra/supabase/migrations 2>/dev/null)" ]; then reasons+=("database migration"); fi
if [ -n "$(git diff --name-only $RANGE -- apps/mobile/android apps/mobile/ios apps/mobile/package.json apps/mobile/capacitor.config.ts 2>/dev/null)" ]; then reasons+=("native shell changed"); fi
if [ -n "${GH_TOKEN:-}" ] && [ -n "${GH_REPO:-}" ]; then
  for c in $(git rev-list $RANGE | head -200); do
    # A merged PR whose description has a line starting with MAJOR (optionally "Release: MAJOR") is a major release.
    if gh api "repos/$GH_REPO/commits/$c/pulls" --jq '.[].body // ""' 2>/dev/null | tr -d '\r' | grep -Eq '^[^A-Za-z]*(Release[^A-Za-z]*)?MAJOR\b'; then reasons+=("PR marked MAJOR (${c:0:7})"); break; fi
  done
fi
if [ "${FORCE:-0}" = "1" ]; then reasons+=("forced"); fi

if [ "${#reasons[@]}" -gt 0 ]; then
  joined="$(IFS=,; echo "${reasons[*]}")"
  emit true "$joined"
else
  emit false "only minor changes since $LAST_TAG"
fi
