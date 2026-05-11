# ADR 0001: Queue — pgmq over pg-boss

Status: Accepted (Phase 0, 2026-05-11).

## Context

The job pipeline needs a queue between the cloud Next.js API and the DGX-side Python worker. Constraints from the orchestration plan and [SPEC.md](../SPEC.md):

- Producer is TypeScript on Vercel (Next.js API routes).
- Consumer is Python 3.12 on DGX Spark (`services/dgx-worker`).
- The queue must live inside Supabase Postgres (no extra managed service, free-tier compatible).
- Cloud is **never** allowed to reach into DGX — the worker must poll outbound.
- Visibility-timeout semantics matter: a job that crashes mid-flight must reappear for retry.

Two candidate technologies fit the "queue inside Supabase Postgres" constraint:

### pg-boss

A Node.js library that implements a job queue on top of vanilla Postgres tables. Mature (~10 years), large community.

- ✅ First-class TypeScript API.
- ✅ Works on any Postgres without extra extensions.
- ⚠️ Python client is community-grade and trails the Node feature set.
- ⚠️ Adds a sizable schema (~8 tables) under its own namespace.
- ⚠️ Long-poll semantics depend on the producer-side library; clients don't see queues as plain tables.

### pgmq

A Postgres extension by Tembo that exposes queue semantics through SQL functions (`pgmq.send`, `pgmq.read`, `pgmq.archive`, etc.). Available as a [native Supabase extension](https://supabase.com/blog/supabase-queues).

- ✅ Language-agnostic by design — any client that speaks SQL (psycopg, supabase-js) is first-class.
- ✅ Already provisioned in modern Supabase projects; enable with one `create extension`.
- ✅ Simple mental model: each queue is a table; reads return JSON; visibility-timeout is per-message.
- ✅ Supabase exposes pgmq through both REST and the Supabase JS client, smoothing the Next.js → queue path.
- ⚠️ Extension lifecycle is tied to whatever Postgres version Supabase runs. We accept that — it's already supported.
- ⚠️ Smaller ecosystem than pg-boss; less out-of-the-box scheduling (cron-like deferred jobs). Acceptable for v1 — cron sits separately in Supabase Edge.

## Decision

Use **pgmq**.

Schema choice:

- One queue named `song_generation_jobs`.
- Message body is the `SongGenerationJob` JSON Schema defined in [`docs/contracts/queue-message.schema.json`](../contracts/queue-message.schema.json).
- Default visibility timeout: 5 minutes (max expected 3-min-track p95 + headroom).
- Archive completed jobs into `pgmq_archive_song_generation_jobs` for forensics; purge weekly.

Both producer and consumer speak SQL directly:

- Producer: `supabase.rpc('pgmq_send', { queue_name, msg })` from the Next.js API.
- Consumer: `psycopg` in Python calls `SELECT pgmq.read(...)`.

## Consequences

- We do not need pg-boss's job-name registry, retry config, or cron features for v1. If we need cron-style deferred jobs later, Supabase Cron Functions cover it.
- We get language-symmetric tooling, which matters because the producer is TypeScript and the consumer is Python.
- Migrations under [`infra/supabase/migrations/`](../../infra/supabase/migrations/) carry one extra `CREATE EXTENSION IF NOT EXISTS pgmq;` statement.
- If pgmq ever stops being supported in Supabase (extremely unlikely), the queue can be migrated by replaying archived rows into pg-boss or any other queue.
- We avoid carrying a TypeScript dependency (pg-boss) into the API layer purely for queue semantics — keeps the Vercel function cold start lean.

## Superseded by

None.
