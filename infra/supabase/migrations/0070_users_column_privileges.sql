-- 0070_users_column_privileges.sql
-- Threat-model fixes T-RLS-1 / T-RLS-2 (docs/SECURITY-THREAT-MODEL.md).
--
-- Before: Supabase's default grants gave anon + authenticated every column on public.users, and the policy
-- users_select_public_handle (0027) exposes every row with a handle. So `anon` could read email, tier, name,
-- locale and agent_plan of all handled users via /rest/v1/users, and any signed-in user could PATCH their own
-- agent_plan to 'pro' (the tier trigger only guards `tier`), which planForTier() honours: a free account
-- would get the Sonnet+Opus pipeline and the pro Lyria spend cap.
--
-- After: anon sees only the public slice; authenticated users can only write the columns the app actually
-- writes through the user client (handle via claim_handle, name, locale). service_role is untouched.
-- Remaining gap (authenticated cross-user email read) is tracked in the threat-model doc.

revoke all on table public.users from anon;
grant select (id, handle, created_at) on table public.users to anon;

revoke insert, update, delete, truncate, references, trigger on table public.users from authenticated;
grant update (handle, name, locale) on table public.users to authenticated;

-- Authenticated users must not read other users' rows (email, tier, ...) through the handle policy; anon only.
-- Signed-in reads of public profiles go through the public_profiles view (see follow-up migration).
alter policy users_select_public_handle on public.users to anon;
