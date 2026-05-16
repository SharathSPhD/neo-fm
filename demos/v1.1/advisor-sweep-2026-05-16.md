# Supabase advisor sweep — 2026-05-16, post migration 0027

Run via `get_advisors(type=security)`. After migration 0027 lands
and the dashboard toggle is flipped for leaked-password protection
(see SECURITY.md §6), the *only* findings should be the documented
"ACCEPTED" SECURITY DEFINER warnings below.

## Status as of 2026-05-16, before the dashboard toggle

| Finding | Severity | Status | Notes |
| --- | --- | --- | --- |
| `security_definer_view (public.recent_vocal_quality)` | ERROR | **RESOLVED** | Recreated as `SECURITY INVOKER` in migration 0027. |
| `security_definer_view (public.public_profiles)` | ERROR | **RESOLVED** | Same fix; `users` SELECT widened to `using (handle is not null)`. |
| `rls_policy_always_true (song_reports_insert_auth)` | WARN | **RESOLVED** | Split into `song_reports_insert_anon (reporter_id is null)` + `song_reports_insert_authn (reporter_id = auth.uid())`. |
| `anon_security_definer_function_executable (validate_handle)` | WARN | **RESOLVED** | `EXECUTE` revoked from anon and authenticated; it is a trigger function. |
| `auth_leaked_password_protection` | WARN | **PENDING DASHBOARD** | Toggle: `Authentication -> Policies -> Password security`. No SQL migration possible. |
| `anon_security_definer_function_executable (submit_feedback)` | WARN | **ACCEPTED** | Only path for anonymous feedback writes. ADR 0021. |
| `anon_security_definer_function_executable (join_waitlist)` | WARN | **ACCEPTED** | Only path for anonymous waitlist writes. ADR 0021. |
| `authenticated_security_definer_function_executable (create_song_job)` | WARN | **ACCEPTED** | Direct INSERT on `jobs` revoked. ADR 0008. |
| `authenticated_security_definer_function_executable (create_section_regen_job)` | WARN | **ACCEPTED** | Same. |
| `authenticated_security_definer_function_executable (publish_song)` | WARN | **ACCEPTED** | Mints `public_id`. ADR 0013. |
| `authenticated_security_definer_function_executable (recover_song_job)` | WARN | **ACCEPTED** | Needs `pgmq.send`. Sprint C (b). |
| `authenticated_security_definer_function_executable (submit_feedback)` | WARN | **ACCEPTED** | (same row as anon, double-flagged) |
| `authenticated_security_definer_function_executable (join_waitlist)` | WARN | **ACCEPTED** | (same row as anon, double-flagged) |

Migration `0027_security_advisors` also documents every accepted
function with `COMMENT ON FUNCTION` so the next sweep doesn't
re-litigate intent.

## Status after the dashboard toggle (expected)

The 12-row `ACCEPTED` set above should remain. All others
(`security_definer_view`, `rls_policy_always_true`,
`auth_leaked_password_protection`, anon-`validate_handle`) should
disappear from the advisor.

## Replay

```sh
# Via Supabase MCP from inside an agent:
get_advisors project_id=lsxicfgqtdxvlcivlwmd type=security

# Via CLI (requires the access token):
supabase --project-ref lsxicfgqtdxvlcivlwmd advisor list --type security
```
