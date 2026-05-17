-- 0040_publish_song_batch.sql -- v1.4 Sprint 15
--
-- The library page gains a toolbar batch action so users can select
-- multiple completed songs and publish them all at once. The single-
-- song RPC `publish_song(uuid, text)` (migration 0013) already
-- handles authorisation, visibility, and slug minting per row. This
-- migration ships `publish_song_batch(uuid[], text)` which:
--
--   1. Wraps N single-row publish_song calls in one transaction so
--      either all rows publish or none do (avoids "5 of 7 published"
--      surprises).
--   2. Enforces the free-tier per-user cap (≤ 5 public songs/user)
--      at the database boundary so the UI cannot bypass it by
--      hand-crafting a fan-out of POSTs.
--   3. Returns a per-row outcome (skipped / published / quota_hit /
--      not_found / not_completed) so the toolbar's confirmation
--      modal renders an accurate post-action summary.
--
-- The cap only applies when the requested visibility is `public`;
-- batches of `unlisted` and `private` rows skip the cap (unlisted
-- songs don't appear on /discover so the spam vector is bounded by
-- URL secrecy, not user count).

set local statement_timeout to '60s';

-- 1. Free-tier per-user public quota constant -------------------------------
--    Kept as a plpgsql `case` arm in the function body rather than a
--    settings row so it travels with the migration and can't be
--    silently raised by an operator with `alter database`.
--
--    If neo-fm grows a paid tier, the cap becomes a per-row entry in
--    a future `billing_plans` table. For v1.4 the constant works.

-- 2. Batch RPC --------------------------------------------------------------

create or replace function public.publish_song_batch(
  p_job_ids uuid[],
  p_visibility text
)
returns table (
  job_id uuid,
  public_id text,
  visibility public.song_visibility_enum,
  published_at timestamptz,
  outcome text  -- 'published' | 'already_public' | 'quota_hit' | 'not_found' | 'forbidden' | 'not_completed'
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_visibility public.song_visibility_enum;
  v_free_tier_cap constant integer := 5;
  v_current_public_count integer := 0;
  v_remaining integer;
  v_id uuid;
  v_owner uuid;
  v_status public.job_status_enum;
  v_existing_public_id text;
  v_existing_visibility public.song_visibility_enum;
  v_published_at timestamptz;
  v_new_public_id text;
  v_attempts integer;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- Cap the batch fan-out so a runaway client can't pin a
  -- transaction by feeding millions of ids. 100 matches the largest
  -- library page size the toolbar supports.
  if array_length(p_job_ids, 1) is null then
    return;
  end if;
  if array_length(p_job_ids, 1) > 100 then
    raise exception 'batch size exceeds limit (max 100 ids)'
      using errcode = '22023';
  end if;

  begin
    v_visibility := p_visibility::public.song_visibility_enum;
  exception when others then
    raise exception 'invalid visibility: %', p_visibility
      using errcode = '22023';
  end;

  -- Count rows that would consume the quota *before* we mutate
  -- anything. The cap applies to `public` rows only. Unlisted /
  -- private don't push the counter.
  if v_visibility = 'public' then
    select count(*)
      into v_current_public_count
      from public.jobs j
      where j.user_id = v_uid
        and j.published_visibility = 'public';
    v_remaining := v_free_tier_cap - v_current_public_count;
  else
    v_remaining := array_length(p_job_ids, 1);  -- effectively unlimited
  end if;

  foreach v_id in array p_job_ids loop
    select j.user_id, j.status, j.public_id, j.published_visibility, j.published_at
      into v_owner, v_status, v_existing_public_id, v_existing_visibility, v_published_at
      from public.jobs j
      where j.id = v_id;

    if v_owner is null then
      job_id := v_id;
      public_id := null;
      visibility := null;
      published_at := null;
      outcome := 'not_found';
      return next;
      continue;
    end if;

    if v_owner <> v_uid then
      job_id := v_id;
      public_id := null;
      visibility := null;
      published_at := null;
      outcome := 'forbidden';
      return next;
      continue;
    end if;

    if v_status <> 'completed' then
      job_id := v_id;
      public_id := v_existing_public_id;
      visibility := v_existing_visibility;
      published_at := v_published_at;
      outcome := 'not_completed';
      return next;
      continue;
    end if;

    -- Skip rows that are already at the requested visibility — no
    -- point re-publishing what's already public, and the quota
    -- counter shouldn't double-count them.
    if v_existing_visibility = v_visibility and v_existing_public_id is not null then
      job_id := v_id;
      public_id := v_existing_public_id;
      visibility := v_existing_visibility;
      published_at := v_published_at;
      outcome := 'already_public';
      return next;
      continue;
    end if;

    -- Free-tier cap check (public only). Songs that were already
    -- public don't consume the quota again.
    if v_visibility = 'public'
       and v_existing_visibility <> 'public'
       and v_remaining <= 0 then
      job_id := v_id;
      public_id := v_existing_public_id;
      visibility := v_existing_visibility;
      published_at := v_published_at;
      outcome := 'quota_hit';
      return next;
      continue;
    end if;

    -- Mint a public_id on first publish; reuse on subsequent.
    if v_existing_public_id is null and v_visibility <> 'private' then
      v_attempts := 0;
      loop
        v_new_public_id := public.gen_public_id();
        v_attempts := v_attempts + 1;
        begin
          update public.jobs
             set public_id = v_new_public_id,
                 published_visibility = v_visibility,
                 published_at = now()
           where id = v_id
           returning published_at into v_published_at;
          v_existing_public_id := v_new_public_id;
          exit;
        exception when unique_violation then
          if v_attempts > 8 then
            raise exception 'failed to mint unique public_id after % attempts',
              v_attempts;
          end if;
        end;
      end loop;
    else
      update public.jobs
         set published_visibility = v_visibility,
             published_at = case
               when v_visibility = 'private' then null
               when v_existing_public_id is null then now()
               else coalesce(published_at, now())
             end
       where id = v_id
       returning published_at into v_published_at;
    end if;

    if v_visibility = 'public' and v_existing_visibility <> 'public' then
      v_remaining := v_remaining - 1;
    end if;

    job_id := v_id;
    public_id := v_existing_public_id;
    visibility := v_visibility;
    published_at := v_published_at;
    outcome := 'published';
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.publish_song_batch(uuid[], text) from public;
grant execute on function public.publish_song_batch(uuid[], text) to authenticated;

comment on function public.publish_song_batch(uuid[], text) is
  'v1.4 Sprint 15: batch publish RPC used by the library toolbar. '
  'Wraps N publish_song calls in one transaction; enforces the '
  'free-tier 5-public-songs-per-user cap at the DB boundary; '
  'returns a per-row outcome (published / quota_hit / not_found / '
  'forbidden / not_completed / already_public).';
