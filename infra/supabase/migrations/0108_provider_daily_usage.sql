-- 0108_provider_daily_usage.sql: one shared per-day request counter per paid provider (Lyria, Veo, TTS).
-- The providers cap requests per day (Lyria 3 Pro 500, Veo 10, TTS 100; reset at midnight Pacific). Batch renders (pool, lab,
-- test-render) used the whole Lyria day and real users' songs were refused. reserve_provider_call counts one request and says
-- no once today's cap for the caller's class is spent: a 'batch' caller also stops at p_batch_cap, which leaves the rest of
-- p_total_cap for 'user' songs. Service role only. The app fails open until this is applied.

create table if not exists public.provider_daily_usage (
  day date not null,
  provider text not null check (provider in ('lyria', 'veo', 'tts')),
  bucket text not null check (bucket in ('user', 'batch')),
  n integer not null default 0 check (n >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, provider, bucket)
);
alter table public.provider_daily_usage enable row level security;
revoke all on public.provider_daily_usage from public, anon, authenticated;
grant select on public.provider_daily_usage to service_role;

create or replace function public.reserve_provider_call(p_provider text, p_bucket text, p_total_cap integer, p_batch_cap integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_user integer;
  v_batch integer;
begin
  if p_provider not in ('lyria', 'veo', 'tts') or p_bucket not in ('user', 'batch') then
    raise exception 'bad_args' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('provider_daily:' || p_provider, 0));
  select coalesce(sum(n) filter (where bucket = 'user'), 0), coalesce(sum(n) filter (where bucket = 'batch'), 0)
    into v_user, v_batch
    from public.provider_daily_usage where day = v_day and provider = p_provider;
  if v_user + v_batch + 1 > p_total_cap then return false; end if;
  if p_bucket = 'batch' and v_batch + 1 > p_batch_cap then return false; end if;
  insert into public.provider_daily_usage(day, provider, bucket, n) values (v_day, p_provider, p_bucket, 1)
  on conflict (day, provider, bucket) do update set n = public.provider_daily_usage.n + 1, updated_at = now();
  return true;
end $$;

revoke all on function public.reserve_provider_call(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_provider_call(text, text, integer, integer) to service_role;
