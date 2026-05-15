# infra/supabase/migrations

Real SQL migrations for Phase 4a. Apply via the Supabase CLI:

```bash
supabase link --project-ref lsxicfgqtdxvlcivlwmd
supabase db push
```

Or, in MCP-driven flows (Cursor / Claude), apply each file in order with
`mcp_supabase_apply_migration` keyed on the file name (without the `.sql`).

## Order

1. `0001_init.sql` — extensions, enums, `users`, `subscriptions`,
   `handle_new_user` auth trigger.
2. `0002_song_documents.sql` — `song_documents` (immutable after insert).
3. `0003_jobs_tracks.sql` — `jobs` (ADR 0007/0008 fields), `tracks` with
   `(job_id, attempt_id)` idempotency.
4. `0004_queue.sql` — pgmq `song_generation_jobs` + DLQ, `tracks` storage
   bucket, per-tier quota helpers.
5. `0005_rls.sql` — RLS policies for `public.*` + storage policies + tier
   trigger.
6. `0006_worker_role.sql` — least-privilege `neo_fm_worker` role.
7. `0007_queue_helpers.sql` — service_role-only `enqueue_song_generation_job`
   SECURITY DEFINER wrapper for `pgmq.send`.
8. `0008_create_song_job.sql` — atomic `create_song_job` RPC (per-user
   advisory lock + quota check + inserts + enqueue) and revoke of direct
   INSERT on `song_documents` / `jobs` from `authenticated`. Closes the
   "bypass /api/songs via PostgREST" hole flagged in the Phase 4
   adversarial review.
9. `0009_quota_monthly.sql` — ADR 0009 + ADR 0005: switches the quota window
   from daily to monthly (free=3, creator=100, pro=1000 songs/month), adds
   `v_user_storage_bytes` view + `user_tier_storage_bytes_cap` helper, and
   updates `create_song_job` to reject when storage usage + estimated new
   bytes would exceed the tier cap (`storage_quota_exceeded` error).
10. `0010_worker_bypassrls.sql` — ADR 0004 follow-up: gives `neo_fm_worker`
    `BYPASSRLS`. Without it the worker's CAS update on `public.jobs` saw
    zero rows because the table's RLS policies only listed `authenticated`,
    and the worker silently archived every message as "not claimable".
    Least-privilege is still enforced by the column-level grants from 0006.

## Notes

- The `neo_fm_worker` role is created without LOGIN. The operator sets a
  password (and grants LOGIN) out of band; the password lives in the DGX
  `.env` for `services/dgx-worker` and never in git.
- Storage path convention for the `tracks` bucket:
  `tracks/<job_id>/<attempt_id>.<ext>`. The RLS policy in 0005 reads
  `storage.foldername(name)[1]` as the `job_id` to authorize signed-URL
  fetches.
- These migrations are idempotent: applying twice is safe.

See [docs/SPEC.md](../../../docs/SPEC.md) §5 for the canonical data model
and [docs/DECISIONS/](../../../docs/DECISIONS/) for the ADRs referenced
above (0001 queue, 0004 worker role, 0005 storage retention,
0007 observability, 0008 leases + retries + DLQ).
