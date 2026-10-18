-- 0089_song_packs.sql -- one-off gift-song packs (Stripe Checkout mode=payment).
--
-- A pack is a bundle of song credits bought once, outside the monthly tier quota. The webhook grants it with
-- grant_song_pack() (idempotent on the Checkout session id, so Stripe's at-least-once delivery cannot double-credit);
-- the occasion-song flow spends one with consume_pack_song(). Both are service-role only.

set local search_path = public, extensions;

create table if not exists public.song_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_session_id text not null unique,
  sku text not null check (sku in ('single','three')),
  songs_total int not null check (songs_total > 0),
  songs_used int not null default 0,
  created_at timestamptz not null default now(),
  constraint song_packs_used_within_total check (songs_used between 0 and songs_total)
);

create index if not exists song_packs_user_idx on public.song_packs (user_id, created_at);

comment on table public.song_packs is
  'Gift-song packs bought via Stripe Checkout (one-off). Written only by grant_song_pack/consume_pack_song under service-role.';

alter table public.song_packs enable row level security;

-- Supabase grants ALL on new public tables to anon/authenticated; clients only ever read their own rows.
revoke all on public.song_packs from public, anon, authenticated;
grant select on public.song_packs to authenticated;

create policy song_packs_select_own on public.song_packs
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.grant_song_pack(
  p_user_id uuid,
  p_session_id text,
  p_sku text,
  p_songs int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_session_id, '') = '' then
    raise exception 'missing_args' using errcode = '22023';
  end if;
  insert into public.song_packs (user_id, stripe_session_id, sku, songs_total)
  values (p_user_id, p_session_id, p_sku, p_songs)
  on conflict (stripe_session_id) do nothing;
end;
$$;

-- Spends one song from the user's oldest pack with credit left. Returns the pack id, or null when none is left.
create or replace function public.consume_pack_song(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.song_packs
     set songs_used = songs_used + 1
   where songs_used < songs_total
     and id = (
     select id from public.song_packs
      where user_id = p_user_id and songs_used < songs_total
      order by created_at
      limit 1
      -- Plain FOR UPDATE, not SKIP LOCKED: a concurrent consume waits for the lock instead of seeing no row and
      -- wrongly reporting "no credit" to a user who still has some.
      for update
   )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.grant_song_pack(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.consume_pack_song(uuid) from public, anon, authenticated;
grant execute on function public.grant_song_pack(uuid, text, text, int) to service_role;
grant execute on function public.consume_pack_song(uuid) to service_role;
