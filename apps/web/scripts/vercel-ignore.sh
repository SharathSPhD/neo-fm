#!/bin/sh
# Vercel ignoreCommand: exit 0 = skip the build, exit 1 = build.
# Always build a redeploy of the same commit (env-only changes) or when FORCE_BUILD is set.
[ -n "$FORCE_BUILD" ] && exit 1
[ "$VERCEL_GIT_PREVIOUS_SHA" = "$VERCEL_GIT_COMMIT_SHA" ] && exit 1
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- ':/apps/web' ':/packages' ':/package.json' ':/pnpm-lock.yaml' ':/pnpm-workspace.yaml' ':/turbo.json' ':/tsconfig.base.json'
