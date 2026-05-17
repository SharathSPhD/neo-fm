-- 0038_user_presets.sql -- v1.4 Sprint 4 (creation-canvas: save-as-preset)
--
-- The Advanced disclosure on /songs/new now exposes tempo, key, raga,
-- tala, orchestration, mix, and section tags. Users routinely re-use
-- the same combination across songs ("my Saveri morning ballad" or
-- "my Yaman wedding mode") so we ship a personal preset surface:
--
--   * A `user_presets` table owned by the authenticated user, mirroring
--     the public `style_presets` shape so the existing
--     `PresetGallery` can render both feeds.
--   * RLS scoped to `auth.uid()` for SELECT/INSERT/DELETE — no UPDATE,
--     the workflow is "save a fresh snapshot" not "edit in place".
--   * SECURITY DEFINER RPCs `save_user_preset(...)` and
--     `delete_user_preset(...)` so the API can enforce trim, length,
--     and per-user cap (20 presets/user — keeps the gallery snappy and
--     prevents abuse) without round-tripping the rules through TS.
--
-- The shape stores the full song_document JSON, plus four index
-- columns (style_family / language / target_duration_seconds / title)
-- mirroring `style_presets` so the gallery query is a single index
-- scan, not a JSONB extraction.

set local statement_timeout to '60s';

create table if not exists public.user_presets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  style_family public.style_family_enum not null,
  language    public.language_enum not null,
  target_duration_seconds smallint not null,
  song_document jsonb not null,
  created_at  timestamptz not null default now()
);

comment on table public.user_presets is
  'v1.4 Sprint 4: personal SongDocument presets saved from the creation '
  'canvas Advanced disclosure. Capped at 20 per user; RLS-scoped to '
  'auth.uid(). No UPDATE — re-saving a snapshot creates a fresh row.';

create index if not exists user_presets_user_id_created_idx
  on public.user_presets (user_id, created_at desc);

alter table public.user_presets enable row level security;

drop policy if exists user_presets_select_own on public.user_presets;
create policy user_presets_select_own on public.user_presets
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_presets_insert_own on public.user_presets;
create policy user_presets_insert_own on public.user_presets
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_presets_delete_own on public.user_presets;
create policy user_presets_delete_own on public.user_presets
  for delete to authenticated
  using (user_id = auth.uid());

-- ----- save_user_preset -----------------------------------------------
--
-- Wraps INSERT so the RPC can enforce:
--   1. Title trim + length cap (120 chars; mirrors SONG_TITLE_MAX_CHARS
--      and the song_documents.title constraint).
--   2. Per-user cap (20). When the cap is hit we error with a precise
--      sqlstate so the API can map 409 instead of a generic 500.
--   3. style_family / language / target_duration_seconds extracted from
--      the document_json so the index columns match. The caller may
--      pass them explicitly but we re-derive from JSON to keep the
--      table consistent.
create or replace function public.save_user_preset(
  p_title text,
  p_song_document jsonb
)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text;
  v_style public.style_family_enum;
  v_language public.language_enum;
  v_duration smallint;
  v_count integer;
  v_id uuid;
  v_created timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'empty_title' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;

  -- Derive index columns from the JSON. Any missing/invalid value
  -- becomes a deliberate validation error so the row is never
  -- partially populated.
  begin
    v_style := (p_song_document ->> 'style_family')::public.style_family_enum;
    v_language := (p_song_document ->> 'language')::public.language_enum;
    v_duration := (p_song_document ->> 'target_duration_seconds')::smallint;
  exception when others then
    raise exception 'invalid_song_document' using errcode = '22023';
  end;

  if v_style is null or v_language is null or v_duration is null then
    raise exception 'invalid_song_document' using errcode = '22023';
  end if;

  select count(*) into v_count
    from public.user_presets
   where user_id = v_uid;

  if v_count >= 20 then
    raise exception 'too_many_presets' using errcode = '23505';
  end if;

  insert into public.user_presets (
    user_id, title, style_family, language,
    target_duration_seconds, song_document
  ) values (
    v_uid, v_title, v_style, v_language, v_duration, p_song_document
  )
  returning public.user_presets.id, public.user_presets.created_at
    into v_id, v_created;

  return query select v_id, v_created;
end;
$$;

revoke execute on function public.save_user_preset(text, jsonb) from public;
grant  execute on function public.save_user_preset(text, jsonb)
  to authenticated, service_role;

comment on function public.save_user_preset(text, jsonb) is
  'v1.4 Sprint 4: insert a personal preset for the authenticated user. '
  'SECURITY DEFINER so RLS does not block when the row goes in; the '
  'function manually enforces auth.uid() ownership, title cap (120 '
  'chars), and per-user cap (20 presets, sqlstate 23505).';

-- ----- delete_user_preset ---------------------------------------------
create or replace function public.delete_user_preset(p_preset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select user_id into v_owner
    from public.user_presets
   where public.user_presets.id = p_preset_id;

  if v_owner is null then
    raise exception 'preset_not_found' using errcode = '42704';
  end if;
  if v_owner <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.user_presets
   where public.user_presets.id = p_preset_id;
end;
$$;

revoke execute on function public.delete_user_preset(uuid) from public;
grant  execute on function public.delete_user_preset(uuid)
  to authenticated, service_role;
