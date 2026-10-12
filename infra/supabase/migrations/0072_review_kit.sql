-- 0072_review_kit.sql
-- Native-speaker review kit: a fixed set of songs per language, token-link reviewers, 1-5 ratings.
-- No PII: reviewers are identified only by an opaque token and an optional alias the operator chooses
-- (e.g. "Kannada reviewer A"). Tokens are stored as SHA-256 hashes. Service role only (no policies).
create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('hi','kn','ta','te','bn')),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists review_items_language_idx on public.review_items (language, position);

create table if not exists public.review_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  language text not null check (language in ('hi','kn','ta','te','bn')),
  alias text check (alias is null or char_length(alias) <= 60),
  created_at timestamptz not null default now(),
  -- Links expire (default 14 days) and can be revoked by the operator.
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (expires_at > created_at)
);

create table if not exists public.review_ratings (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.review_tokens(id) on delete cascade,
  item_id uuid not null references public.review_items(id) on delete cascade,
  lyric_quality smallint not null check (lyric_quality between 1 and 5),
  pronunciation smallint not null check (pronunciation between 1 and 5),
  prosody smallint not null check (prosody between 1 and 5),
  cultural_fit smallint not null check (cultural_fit between 1 and 5),
  sounds_native boolean not null,
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token_id, item_id)
);

alter table public.review_items enable row level security;
alter table public.review_tokens enable row level security;
alter table public.review_ratings enable row level security;
-- Service role only: RLS with no policies, and Supabase grants ALL on new public tables by default, so revoke that too.
revoke all on public.review_items, public.review_tokens, public.review_ratings from anon, authenticated, public;
