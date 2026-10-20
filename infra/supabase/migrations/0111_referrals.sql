-- 0111_referrals.sql
-- DRAFT, NOT APPLIED. Needs S's tap before prod apply. Recognition-only referrals: records which public @handle's shared
-- link a new listener arrived from, so the app can say "joined from a friend" and show the sharer a count. No credits.
-- Degrades gracefully: until applied, POST /api/referral/claim answers 204 and the account page shows no referral line.
-- Service-role only (RLS on, no policies). One row per referee; the first claim wins.

set local search_path = public, extensions;

create table if not exists public.referrals (
  referee_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  source text not null default '' check (char_length(source) <= 40),
  created_at timestamptz not null default now(),
  check (referee_id <> referrer_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;
revoke all on public.referrals from public, anon, authenticated;
