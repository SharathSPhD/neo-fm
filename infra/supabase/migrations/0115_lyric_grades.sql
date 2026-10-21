-- 0115_lyric_grades.sql -- Premium / Studio lyric-grade credits (strategy/premium-lyrics-tier.md section 10).
--
-- One ledger row per credit event. 'grant' rows are add-on purchases (Stripe Checkout, idempotent on the session id);
-- 'use' rows are songs, charged to the monthly tier allowance first and to add-on credit after. The allowance size lives in
-- code (lib/lyrics/grade.ts) and is passed in, so re-tuning it needs no migration. All functions are service-role only.
-- The app treats a missing table or function as "no credit", so it can ship before this is applied (LYRIC_GRADES also gates it).

set local search_path = public, extensions;

create table if not exists public.lyric_grade_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  grade text not null check (grade in ('premium','studio')),
  kind text not null check (kind in ('grant','use')),
  source text not null check (source in ('allowance','addon')),
  ref text not null,
  created_at timestamptz not null default now(),
  constraint lyric_grade_ledger_grant_is_addon check (kind <> 'grant' or source = 'addon'),
  constraint lyric_grade_ledger_ref_once unique (user_id, kind, ref)
);

create index if not exists lyric_grade_ledger_user_idx on public.lyric_grade_ledger (user_id, created_at);

comment on table public.lyric_grade_ledger is
  'Premium/Studio lyric credits: add-on grants and per-song uses. Written only by grant_lyric_addon/spend_lyric_grade/refund_lyric_grade.';

alter table public.lyric_grade_ledger enable row level security;
revoke all on public.lyric_grade_ledger from public, anon, authenticated;
grant select on public.lyric_grade_ledger to authenticated;

create policy lyric_grade_ledger_select_own on public.lyric_grade_ledger
  for select to authenticated
  using (user_id = auth.uid());

-- Add-on purchase. Idempotent on the Checkout session id, so Stripe's at-least-once delivery cannot double-credit.
create or replace function public.grant_lyric_addon(p_user_id uuid, p_session_id text, p_grade text, p_songs int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_session_id, '') = '' or p_songs is null or p_songs < 1 then
    raise exception 'missing_args' using errcode = '22023';
  end if;
  insert into public.lyric_grade_ledger (user_id, grade, kind, source, ref)
  select p_user_id, p_grade, 'grant', 'addon', p_session_id || ':' || n
    from generate_series(1, p_songs) as n
  on conflict (user_id, kind, ref) do nothing;
end;
$$;

-- Per-grade view for one listener: allowance used since p_since and add-on credit left (grants minus add-on uses).
create or replace function public.lyric_grade_state(p_user_id uuid, p_since timestamptz)
returns table (grade text, allowance_used int, addon_left int)
language sql
stable
security definer
set search_path = ''
as $$
  select g.grade,
         count(*) filter (where l.kind = 'use' and l.source = 'allowance' and l.created_at >= p_since)::int,
         (count(*) filter (where l.kind = 'grant') - count(*) filter (where l.kind = 'use' and l.source = 'addon'))::int
    from (values ('premium'), ('studio')) as g(grade)
    left join public.lyric_grade_ledger l on l.user_id = p_user_id and l.grade = g.grade
   group by g.grade;
$$;

-- Spends one credit: the monthly allowance first, then an add-on credit. Returns 'allowance', 'addon', or null when none is
-- left. Serialised per user so two simultaneous songs cannot both take the last credit. A repeat of the same ref returns
-- the source already charged instead of charging again.
create or replace function public.spend_lyric_grade(
  p_user_id uuid, p_grade text, p_allowance int, p_since timestamptz, p_ref text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
  v_addon int;
  v_prev text;
begin
  if p_user_id is null or coalesce(p_ref, '') = '' or p_grade not in ('premium','studio') then
    raise exception 'missing_args' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lyric_grade:' || p_user_id::text, 0));
  select source into v_prev from public.lyric_grade_ledger where user_id = p_user_id and kind = 'use' and ref = p_ref;
  if v_prev is not null then return v_prev; end if;
  select count(*) into v_used from public.lyric_grade_ledger
   where user_id = p_user_id and grade = p_grade and kind = 'use' and source = 'allowance' and created_at >= p_since;
  if v_used < coalesce(p_allowance, 0) then
    insert into public.lyric_grade_ledger (user_id, grade, kind, source, ref) values (p_user_id, p_grade, 'use', 'allowance', p_ref);
    return 'allowance';
  end if;
  select count(*) filter (where kind = 'grant') - count(*) filter (where kind = 'use' and source = 'addon') into v_addon
    from public.lyric_grade_ledger where user_id = p_user_id and grade = p_grade;
  if v_addon > 0 then
    insert into public.lyric_grade_ledger (user_id, grade, kind, source, ref) values (p_user_id, p_grade, 'use', 'addon', p_ref);
    return 'addon';
  end if;
  return null;
end;
$$;

-- Returns a credit when the job could not be created. Idempotent: no row, no effect.
create or replace function public.refund_lyric_grade(p_user_id uuid, p_ref text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.lyric_grade_ledger where user_id = p_user_id and kind = 'use' and ref = p_ref;
$$;

revoke execute on function public.grant_lyric_addon(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.lyric_grade_state(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.spend_lyric_grade(uuid, text, int, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.refund_lyric_grade(uuid, text) from public, anon, authenticated;
grant execute on function public.grant_lyric_addon(uuid, text, text, int) to service_role;
grant execute on function public.lyric_grade_state(uuid, timestamptz) to service_role;
grant execute on function public.spend_lyric_grade(uuid, text, int, timestamptz, text) to service_role;
grant execute on function public.refund_lyric_grade(uuid, text) to service_role;
