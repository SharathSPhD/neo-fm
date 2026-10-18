-- 0106_pass_holder_song_quota.sql: a paid Station pass lifts the free tier's 3 songs/month rows quota to 4 (#242).
--
-- The pass allowance (STATION_PASS_MONTHLY_TRACKS, default 4) is enforced by the per-user Lyria spend envelope in the app.
-- Until now create_song_job also applied the free tier's 3-row cap on top, so a free-tier pass holder got 3, not 4.
-- Only the SQL quota changes here: a pass holder gets the larger of their tier quota and 4. Creator and Pro are untouched.
-- The pass check reads station_passes directly (same status and period rules as has_station_pass) so the function stays
-- security invoker; its select-own RLS policy only ever shows the caller's own row, and create_song_job (security
-- definer) sees all rows.

create or replace function public.user_tier_quota(p_user_id uuid)
returns integer
language sql
stable
set search_path to ''
as $$
  select greatest(
    case coalesce(u.tier, 'free'::public.tier_enum)
      when 'free'      then 3
      when 'creator'   then 15
      when 'pro'       then 40
      when 'developer' then 999999
    end,
    case when exists (
      select 1 from public.station_passes sp
      where sp.user_id = p_user_id
        and sp.status in ('active', 'trialing', 'past_due')
        and sp.current_period_end > now()
    ) then 4 else 0 end
  )
  from public.users u where u.id = p_user_id;
$$;
