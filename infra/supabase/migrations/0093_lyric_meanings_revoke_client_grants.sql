-- 0093_lyric_meanings_revoke_client_grants.sql
-- 0076 created song_lyric_meanings with RLS on and no policies, but did not revoke Supabase's default table grants,
-- so anon and authenticated kept ALL privileges (RLS still denied every row). The table is service-role only; withdraw
-- the grants so the client-grants audit and defence in depth hold. Already applied to neo-fm-prod by hand; idempotent.
revoke all on public.song_lyric_meanings from public, anon, authenticated;
