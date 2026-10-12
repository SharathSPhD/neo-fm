#!/usr/bin/env bash
# RLS audit against a throwaway Postgres.
#
#   RLS_AUDIT_DB_URL=postgresql://postgres@localhost:5432/rls_audit scripts/rls-audit.sh
#
# 1. loads infra/supabase/ci/bootstrap.sql (Supabase roles, auth/storage schemas, extension shims)
# 2. applies every infra/supabase/migrations/*.sql in order (the real pgmq / pg_net / pg_cron /
#    pg_jsonschema `create extension` lines and 0043's pgmq presence check
#    are skipped; bootstrap.sql shims them)
# 3. runs infra/supabase/tests/rls_audit.sql (structural + behavioural) and client_grants.sql
#
# The target database must be empty and disposable: the script drops and recreates schema public.
set -euo pipefail

: "${RLS_AUDIT_DB_URL:?set RLS_AUDIT_DB_URL to a disposable Postgres database}"
root="$(cd "$(dirname "$0")/.." && pwd)"
psql_() { psql "$RLS_AUDIT_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "== reset"
psql_ -c "drop schema if exists public, auth, storage, vault, supabase_vault, net, cron, pgmq, extensions cascade; create schema public; grant usage on schema public to public;" >/dev/null

echo "== bootstrap"
psql_ -f "$root/infra/supabase/ci/bootstrap.sql" >/dev/null

echo "== migrations"
count=0
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
for f in "$root"/infra/supabase/migrations/*.sql; do
  sed -E -e 's/^[[:space:]]*create extension if not exists (pgmq|pg_net|pg_cron|pg_jsonschema)[^;]*;/-- shimmed by bootstrap.sql/I' \
      -e "s/select 1 from pg_extension where extname = 'pgmq'/select 1/" "$f" \
    | psql_ -f - >/dev/null 2>"$err" || { echo "FAILED: $(basename "$f")"; cat "$err"; exit 1; }
  count=$((count + 1))
done
echo "applied $count migrations"

echo "== audit"
psql_ -f "$root/infra/supabase/tests/rls_audit.sql"
echo "== client write grants"
psql_ -f "$root/infra/supabase/tests/client_grants.sql"
echo "RLS audit passed"
