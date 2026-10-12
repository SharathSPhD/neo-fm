-- Scrubbed browser error reports (POST /api/client-errors) behind the "Recent errors" panel on /admin/health.
--
-- No PII by construction: the API scrubs emails, tokens, ids, IPs and query strings before insert, and stores
-- only a coarse browser family. Access is service_role only (the API and the bearer-protected admin endpoint);
-- anon and authenticated get nothing, including through any view or default privilege.

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  fingerprint text not null,
  name        text not null,
  message     text not null,
  stack       text,
  route       text not null default '',
  boundary    text not null,
  lang        text,
  release     text,
  ua_family   text not null default 'unknown',
  request_id  text
);

create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);
create index if not exists client_errors_fingerprint_idx on public.client_errors (fingerprint, created_at desc);

-- RLS on with no policies = deny for every non-bypass role; belt and braces with the revokes below.
alter table public.client_errors enable row level security;

revoke all on table public.client_errors from public, anon, authenticated;
revoke all on sequence public.client_errors_id_seq from public, anon, authenticated;
grant select, insert, delete on table public.client_errors to service_role;
grant usage on sequence public.client_errors_id_seq to service_role;

-- Retention: 7 days by default. SECURITY DEFINER + pinned search_path, callable by service_role only.
-- The API prunes opportunistically; for a guaranteed purge run `select public.prune_client_errors();` daily
-- (Supabase cron / the daily snapshot job) or manually.
create or replace function public.prune_client_errors(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.client_errors where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.prune_client_errors(integer) from public, anon, authenticated;
grant execute on function public.prune_client_errors(integer) to service_role;

-- Admin-only rollup of the last 24h by fingerprint, for ad-hoc SQL. security_invoker so it can never widen access
-- beyond what the caller's role already has on the table; privileges revoked on the view itself too (Supabase's
-- default privileges would otherwise grant anon/authenticated SELECT on new public views).
create or replace view public.client_error_groups_24h
with (security_invoker = true) as
select
  fingerprint,
  max(name)       as name,
  max(message)    as message,
  max(route)      as route,
  count(*)        as occurrences,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from public.client_errors
where created_at > now() - interval '24 hours'
group by fingerprint;

revoke all on public.client_error_groups_24h from public, anon, authenticated;
grant select on public.client_error_groups_24h to service_role;
