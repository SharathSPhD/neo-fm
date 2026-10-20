-- 0111_referrals.sql
-- Referral attribution only: who brought whom. NO rewards and no credits (zero spend). DRAFT, NOT APPLIED.
-- The app treats a missing table/function as "referrals unavailable" and nothing runs unless REFERRAL_ENABLED=1.
-- All tables and functions are service-role only.

set local search_path = public, extensions;

create table if not exists public.referral_codes (
  user_id uuid primary key references public.users(id) on delete cascade,
  code text not null unique check (code ~ '^[a-z2-7]{8}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.referral_codes(code) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  -- One referral per receiver, ever: a person can be brought in once.
  receiver_id uuid not null unique references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (sender_id <> receiver_id)
);
create index if not exists referrals_sender_idx on public.referrals (sender_id);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
revoke all on public.referral_codes from public, anon, authenticated;
revoke all on public.referrals from public, anon, authenticated;
grant select, insert on public.referral_codes to service_role;
grant select, insert on public.referrals to service_role;

-- Records that p_receiver arrived through p_code. Returns 'ok', 'invalid', 'self', 'too_old' (only accounts created in
-- the last day can claim) or 'already'.
create or replace function public.claim_referral(p_receiver uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid;
  v_id uuid;
begin
  select user_id into v_sender from public.referral_codes where code = p_code;
  if v_sender is null then return 'invalid'; end if;
  if v_sender = p_receiver then return 'self'; end if;
  if not exists (select 1 from public.users where id = p_receiver and created_at > now() - interval '1 day') then
    return 'too_old';
  end if;
  insert into public.referrals (code, sender_id, receiver_id)
  values (p_code, v_sender, p_receiver)
  on conflict (receiver_id) do nothing
  returning id into v_id;
  if v_id is null then return 'already'; end if;
  return 'ok';
end;
$$;

revoke execute on function public.claim_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_referral(uuid, text) to service_role;
