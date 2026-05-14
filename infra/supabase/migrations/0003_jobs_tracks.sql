-- 0003_jobs_tracks.sql -- jobs (with ADR-0007/0008 fields) and tracks
--
-- jobs holds the lifecycle of a single song generation. Producer (cloud API)
-- inserts with status='queued'; worker transitions to 'processing' under
-- lease + heartbeat, then to 'completed' or 'failed'. ADR 0008 owns the
-- retry / DLQ semantics; ADR 0007 owns trace_id propagation.
--
-- tracks holds the final rendered artifact. The (job_id, attempt_id) unique
-- constraint is the worker's idempotency key: replaying the same attempt
-- never inserts twice.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  song_document_id uuid not null references public.song_documents(id) on delete cascade,
  status public.job_status_enum not null default 'queued',
  priority integer not null default 0,
  progress numeric(4,3) not null default 0 check (progress >= 0 and progress <= 1),
  attempts integer not null default 0,
  attempt_id uuid,
  trace_id text,
  last_attempt_at timestamptz,
  lease_renewed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists jobs_user_id_created_idx
  on public.jobs (user_id, created_at desc);
create index if not exists jobs_status_idx
  on public.jobs (status) where status in ('queued','processing');
create index if not exists jobs_song_document_id_idx
  on public.jobs (song_document_id);

comment on column public.jobs.progress is
  'Per-section UX progress, 0.000..1.000 (ADR 0007 / SPEC §5 / C8). Worker writes via the neo_fm_worker role; authenticated users cannot UPDATE.';
comment on column public.jobs.attempt_id is
  'ADR 0008: per-attempt UUID assigned by the producer (first attempt) or worker (retry). Mirrors the queue message attempt_id and feeds the tracks idempotency key.';
comment on column public.jobs.lease_renewed_at is
  'ADR 0008: worker heartbeat. If now() - lease_renewed_at > visibility_timeout the pgmq message becomes visible to another consumer.';

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  attempt_id uuid not null,
  url text not null,
  bytes bigint,
  duration_seconds integer,
  format public.track_format_enum not null default 'mp3',
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, attempt_id)
);

create index if not exists tracks_job_id_idx on public.tracks (job_id);

comment on table public.tracks is
  'Rendered audio artifacts. (job_id, attempt_id) is the worker idempotency key; insertions on retry use on conflict do nothing. url is the Storage object path; cloud API mints a signed URL on read (see ADR 0005).';
