# ADR 0004: Dedicated `neo_fm_worker` Postgres role for the DGX worker

Status: Accepted

## Context

`services/dgx-worker` connects to Supabase Postgres to:

- pop jobs off `pgmq` (`song_generation_jobs` queue),
- read the referenced `song_documents` row,
- update `jobs.status`, `jobs.started_at`, `jobs.finished_at`, `jobs.error`,
  and `jobs.progress`,
- insert a row into `tracks` after upload.

The naive option is to use the Supabase `service_role` JWT (or the
super-privileged `postgres` user). That role can read or write **any** row in
**any** table, including `users.email`, `subscriptions.*`, RLS-bypassed.

A leak of the worker's credential — through a container image, a CI log, a
misconfigured Tailscale ACL — would be a privacy-level breach, not a
service-level inconvenience.

## Decision

Phase 4's Supabase migration creates a dedicated Postgres role:

```sql
create role neo_fm_worker login password '<env-injected>';

-- pgmq queue
grant usage  on schema pgmq             to neo_fm_worker;
grant select, update, delete
                              on all tables in schema pgmq to neo_fm_worker;

-- worker reads referenced documents
grant select on public.song_documents   to neo_fm_worker;

-- worker writes job status + tracks
grant select, update (status, started_at, finished_at, error, progress)
                              on public.jobs   to neo_fm_worker;
grant insert                  on public.tracks to neo_fm_worker;

-- explicit deny on sensitive surface
revoke all on public.users         from neo_fm_worker;
revoke all on public.subscriptions from neo_fm_worker;
```

The cloud API uses Supabase `anon`/`authenticated` (via PostgREST + RLS) for
user-scoped reads/writes and `service_role` for the narrow set of
admin-only operations.

The worker connects with `PGUSER=neo_fm_worker` over the standard Supabase
Postgres connection string. Credentials live only in the DGX-side
`.env` (not committed; the compose `env_file` references it).

## Consequences

- A worker credential leak cannot enumerate users or read billing data.
- Schema migrations explicitly grant new tables to `neo_fm_worker` (a
  CI check fails any migration that touches the queue or `jobs` without
  also accounting for this role).
- `dgx-worker` cannot ever `delete from jobs` or impersonate a user —
  this is enforced at the database, not in application code.
- RLS still applies on top: even with `service_role`, the cloud API code
  enforces `auth.uid()` checks, so the same protection ladder runs in two
  independent layers.
