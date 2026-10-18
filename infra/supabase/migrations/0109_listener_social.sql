-- 0109_listener_social.sql
-- DRAFT, NOT APPLIED. Listener-connected social accounts (docs/LISTENER-SOCIAL.md). Needs S's go before prod apply.
-- Degrades gracefully: the API treats a missing table as "not available yet", and nothing runs unless LISTENER_SOCIAL_ENABLED=1.
-- Service-role only (RLS on, no policies): tokens never reach the browser, the API returns label and status only.

set local search_path = public, extensions;

create table if not exists public.user_social_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube','instagram','facebook','tiktok')),
  mode text not null default 'neofm_app' check (mode in ('neofm_app','own_app')),
  label text not null,
  secret_sealed text not null,               -- AES-256-GCM with SOCIAL_TOKEN_KEY; never the raw token
  extra jsonb not null default '{}'::jsonb,  -- channel_id / page_id / ig_user_id / open_id
  connected_at timestamptz not null default now(),
  primary key (user_id, platform)
);

-- Creator and Pro listeners may bring their own developer app. Client id and secret are both sealed.
create table if not exists public.user_social_apps (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube','instagram','facebook','tiktok')),
  client_id_sealed text not null,
  client_secret_sealed text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

alter table public.user_social_accounts enable row level security;
alter table public.user_social_apps enable row level security;
revoke all on public.user_social_accounts, public.user_social_apps from public, anon, authenticated;
