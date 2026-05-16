-- 0019_pricing_waitlist.sql -- waitlist for paid tier CTAs (Sprint E)
--
-- v1.1 ships /pricing with three tiers but only Free is wired to
-- billing (it's just the existing quota). Creator and Pro carry a
-- "Join the waitlist" CTA that drops the visitor's email here.
-- A real Stripe wiring lands in v1.2 -- this table feeds the
-- launch announcement list in the meantime.
--
-- Anonymous insert is allowed (the visitor may not be signed in)
-- but goes through an RPC so we can rate-limit per-IP from the
-- middleware layer (Sprint I).

create table if not exists public.waitlist (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  tier text not null check (tier in ('creator','pro','team')),
  source text not null default 'pricing',
  user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_tier_uniq
  on public.waitlist (lower(email), tier);

comment on table public.waitlist is
  'Email captures from /pricing waitlist CTAs. Drained into the launch announcement list. Never used for transactional email.';

alter table public.waitlist enable row level security;

create policy waitlist_service_only_select on public.waitlist
  for select to service_role using (true);

create or replace function public.join_waitlist(
  p_email text,
  p_tier text,
  p_source text default 'pricing'
)
returns table (joined boolean, already_on_list boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid := auth.uid();
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_tier not in ('creator','pro','team') then
    raise exception 'invalid_tier' using errcode = '22023';
  end if;
  insert into public.waitlist (email, tier, source, user_id)
    values (v_email, p_tier, coalesce(p_source, 'pricing'), v_uid)
    on conflict (lower(email), tier) do nothing;
  if found then
    return query select true, false;
  else
    return query select false, true;
  end if;
end;
$$;

revoke execute on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text)
  to anon, authenticated, service_role;
