-- 0101_waitlist_feedback_service_only.sql
-- Issue #41 (rate limits on anon-callable RPCs). Apply after the web deploy that calls these RPCs as service role
-- (the app works before and after this migration, because service_role keeps EXECUTE).
--
-- Before: join_waitlist and submit_feedback were SECURITY DEFINER and executable by anon and authenticated, so
-- anyone could call /rest/v1/rpc/... directly with the public anon key and skip the per-IP limiter in middleware.
-- Unlimited calls could fill public.waitlist and public.feedback.
--
-- After: only service_role can execute them. /api/waitlist and /api/feedback (rate limited per IP in
-- lib/rate-limit.ts) are the only way in.
revoke execute on function public.join_waitlist(text, text, text) from public, anon, authenticated;
revoke execute on function public.submit_feedback(text, text, text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, text) to service_role;
grant execute on function public.submit_feedback(text, text, text) to service_role;
