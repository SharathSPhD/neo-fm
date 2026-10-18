-- 0103_social_publishing.sql
-- DRAFT, NOT APPLIED. Upload queue and connected accounts for the video publisher (docs/SOCIAL-PUBLISHING.md).
-- Degrades gracefully: the cron treats a missing table as "nothing to do", and nothing runs unless SOCIAL_PUBLISH_ENABLED=1.
-- Needs S to name it before prod apply. Both tables are service-role only (RLS on, no policies).

set local search_path = public, extensions;

create table if not exists public.social_accounts (
  platform text primary key check (platform in ('youtube','instagram','facebook','tiktok')),
  label text not null,
  secret_sealed text not null,               -- AES-256-GCM with SOCIAL_TOKEN_KEY; never the raw token
  extra jsonb not null default '{}'::jsonb,  -- channel_id / page_id / ig_user_id / open_id
  connected_at timestamptz not null default now()
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  pool_track_id uuid not null references public.pool_tracks(id) on delete cascade,  -- pool tracks only
  platform text not null check (platform in ('youtube','instagram','facebook','tiktok')),
  video_path text not null,                  -- object path in the private 'social-videos' bucket
  title text not null,
  caption text not null,
  needs_native_read boolean not null default true,
  native_read_ok boolean not null default false,
  visibility text not null default 'private' check (visibility in ('private','public')),
  status text not null default 'draft' check (status in ('draft','approved','publishing','published','failed','skipped')),
  approved_at timestamptz,
  approval_note text,                        -- S's own words, quoted
  scheduled_at timestamptz not null default now(),
  attempts int not null default 0,
  external_id text,
  external_url text,
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_posts_unique unique (pool_track_id, platform, video_path),
  constraint social_posts_approved_has_time check (status not in ('approved','publishing','published') or approved_at is not null)
);

create index if not exists social_posts_due_idx on public.social_posts (scheduled_at) where status = 'approved';

alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;
revoke all on public.social_accounts, public.social_posts from public, anon, authenticated;

insert into storage.buckets (id, name, public) values ('social-videos', 'social-videos', false) on conflict (id) do nothing;
