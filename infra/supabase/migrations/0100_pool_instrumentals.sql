-- 0100_pool_instrumentals.sql -- let instrumental (no-vocal) tracks into the station pool.
--
-- The diction gate (0092) measures sung lyrics, so a track with no lyrics could never be admitted. An instrumental
-- has no words to get wrong; its admission evidence is a "no vocals" audio check instead. Instrumentals carry the
-- language 'zxx' (ISO 639-2: no linguistic content) so one render serves every listener.
-- Vocal tracks are unchanged: the same CHECK still demands U >= 80 and verdict pass for them.

alter table public.pool_tracks
  add column if not exists kind text not null default 'vocal' check (kind in ('vocal', 'instrumental')),
  add column if not exists vocals_absent boolean;

alter table public.pool_tracks drop constraint if exists pool_tracks_language_check;
alter table public.pool_tracks add constraint pool_tracks_language_check
  check (language in ('hi','ta','te','kn','bn','en','sa','hinglish','zxx'));

alter table public.pool_tracks drop constraint if exists pool_tracks_admit_requires_gate;
alter table public.pool_tracks add constraint pool_tracks_admit_requires_gate check (
  status <> 'admitted' or (
    admitted_at is not null and (
      (kind = 'vocal' and diction_u >= 80 and diction_verdict = 'pass')
      or (kind = 'instrumental' and vocals_absent is true and language = 'zxx')
    )
  )
);

create or replace function public.admit_pool_track(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.pool_tracks;
begin
  select * into t from public.pool_tracks where id = p_id for update;
  if not found then
    raise exception 'pool_track_not_found' using errcode = 'P0002';
  end if;
  if t.kind = 'instrumental' then
    if t.vocals_absent is not true or t.language <> 'zxx' then
      update public.pool_tracks set status = 'rejected' where id = p_id and status = 'candidate';
      return 'rejected';
    end if;
  elsif t.diction_u is null or t.diction_verdict is distinct from 'pass' or t.diction_u < 80 then
    update public.pool_tracks set status = 'rejected' where id = p_id and status = 'candidate';
    return 'rejected';
  end if;
  update public.pool_tracks set status = 'admitted', admitted_at = coalesce(admitted_at, now()) where id = p_id;
  return 'admitted';
end;
$$;

revoke all on function public.admit_pool_track(uuid) from public, anon, authenticated;
grant execute on function public.admit_pool_track(uuid) to service_role;

comment on column public.pool_tracks.kind is 'vocal | instrumental. Instrumentals are admitted on a no-vocals audio check, not the diction gate.';
comment on column public.pool_tracks.vocals_absent is 'Set by the ingest audio check for instrumentals; true is required for admission.';
