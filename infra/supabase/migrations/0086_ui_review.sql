-- 0086_ui_review.sql
-- Native review of UI translations: token-link reviewers approve or edit translated strings.
-- No PII: a reviewer is an opaque token (stored as a SHA-256 hash) plus an optional operator-chosen alias.
-- Service role only: RLS on with no policies, and the default Supabase grants are revoked.
create table if not exists public.ui_review_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  language text not null check (language in ('hi','ta','te','kn','bn')),
  alias text check (alias is null or char_length(alias) <= 60),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (expires_at > created_at)
);

create table if not exists public.ui_review_edits (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.ui_review_tokens(id) on delete cascade,
  key text not null check (char_length(key) <= 120),
  action text not null check (action in ('approve','edit')),
  suggestion text check (suggestion is null or char_length(suggestion) <= 1000),
  comment text check (comment is null or char_length(comment) <= 500),
  -- The translation the reviewer was looking at; edits against an older text are ignored when building a patch.
  base_text text not null check (char_length(base_text) <= 2000),
  updated_at timestamptz not null default now(),
  unique (token_id, key),
  check ((action = 'edit') = (suggestion is not null))
);
create index if not exists ui_review_edits_key_idx on public.ui_review_edits (key);

alter table public.ui_review_tokens enable row level security;
alter table public.ui_review_edits enable row level security;
revoke all on public.ui_review_tokens, public.ui_review_edits from anon, authenticated, public;
