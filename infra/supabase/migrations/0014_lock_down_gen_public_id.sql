-- 0014_lock_down_gen_public_id.sql -- close anon access to publish surface
--
-- Two security-advisor lints (0028 + 0029) flagged that
--   - public.gen_public_id() was callable by anon and authenticated
--   - public.publish_song() was callable by anon
-- via PostgREST's `/rest/v1/rpc/<name>` endpoint.
--
-- gen_public_id() is an internal helper of publish_song(). publish_song is
-- SECURITY DEFINER and executes as its owner, so its caller does not need
-- EXECUTE on the helper. We lock gen_public_id() down to service_role only.
--
-- publish_song() needs to stay callable by `authenticated` (that's the M1
-- publish flow). It does an `auth.uid() is null` check inside, so calling
-- it as anon would have raised at runtime, but we close the door explicitly
-- to silence the lint and avoid surprises.

revoke all on function public.gen_public_id() from public, anon, authenticated;
grant execute on function public.gen_public_id() to service_role;

revoke all on function public.publish_song(uuid, text) from anon;
-- (authenticated already has execute from 0013)
