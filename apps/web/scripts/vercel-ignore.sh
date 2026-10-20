#!/bin/sh
# Vercel ignoreCommand: exit 0 = skip the build, exit 1 = build.
# Always build a redeploy of the same commit (env-only changes) or when FORCE_BUILD is set.
[ -n "$FORCE_BUILD" ] && exit 1
[ "$VERCEL_GIT_PREVIOUS_SHA" = "$VERCEL_GIT_COMMIT_SHA" ] && exit 1
# Build minutes are metered: CI already runs next build on every PR, so branch previews
# only build for branches named preview/*, and staging builds only from the staging branch.
if [ "$VERCEL_PROJECT_ID" = "prj_Tttn9oQbc1ps0g3MpsS3F7WQR5AO" ]; then
  case "$VERCEL_GIT_COMMIT_REF" in staging|preview/*) ;; *) exit 0 ;; esac
else
  case "$VERCEL_GIT_COMMIT_REF" in main|preview/*) ;; *) exit 0 ;; esac
fi
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
# A force-push can orphan the previous commit; git diff would then fail (128) and error the deploy, so build instead.
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA^{commit}" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- ':/apps/web' ':/packages' ':/package.json' ':/pnpm-lock.yaml' ':/pnpm-workspace.yaml' ':/turbo.json' ':/tsconfig.base.json'
