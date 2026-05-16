# Sprint C bug-a operator runbook — auth callback / deployment protection

Code-only fixes ship in this sprint via `app/auth/callback/route.ts`
and `emailRedirectTo` in the sign-up form. Two **manual operator
steps** complete the fix; both are idempotent and reversible.

## Step 1. Vercel deployment protection

The user-reported (a) bug was that a confirmation link landed on the
Vercel production URL but Vercel showed a deployment-protection
login wall first. The Vercel project must allow public traffic on
production.

1. In the Vercel dashboard → **neo-fm-spark** project →
   **Settings → Deployment Protection**.
2. Set **Production**: **Off** (public). The deployment is the public
   marketing surface; restricting it locks every visitor out.
3. Set **Preview Deployments**: **Standard Protection** (default).
   Preview branches stay behind the Vercel SSO wall as before; only
   `/auth/callback` on a preview URL would be blocked, and Supabase's
   redirect URL list (Step 2) keeps confirmation links pointed at
   production.

CLI equivalent (Vercel CLI 35+):

```sh
vercel project settings deployment-protection set production:off
```

Or, scoped via the MCP tool:

```
vercel:update_project { teamId, projectId, ssoProtection: { deploymentType: "preview" } }
```

## Step 2. Supabase redirect URL allowlist

Supabase rejects any redirect that isn't on the project's allowlist.
The list must include:

```
https://app.neo-fm.test/auth/callback
https://neo-fm-spark.vercel.app/auth/callback
http://localhost:3000/auth/callback        # local dev
http://127.0.0.1:3000/auth/callback        # local dev (alt)
```

(Replace `app.neo-fm.test` with the real production hostname once a
custom domain is attached.)

Configure via:

1. Supabase Studio → **Authentication → URL Configuration**.
2. **Site URL**: production hostname.
3. **Redirect URLs**: add each URL above on its own line.

Or via the Supabase MCP tool / Management API:

```
supabase:update_auth_redirect_urls
{
  redirectUrls: [
    "https://app.neo-fm.test/auth/callback",
    "https://neo-fm-spark.vercel.app/auth/callback",
    "http://localhost:3000/auth/callback",
    "http://127.0.0.1:3000/auth/callback"
  ]
}
```

## Step 3. Session-continuity smoke test

Performed after the two manual steps:

1. Open an incognito window on production.
2. `/sign-up` with a new email + password.
3. Wait for the confirmation email.
4. Click the link in the **same browser**.
5. Expect: 303 → `/library`, signed in. No Vercel login wall.

If step 4 lands on /sign-in with `error_description=...`, copy the
description and check:

- "Email link is invalid or has expired" → link is older than 24 h or
  already used. Click "Resend" on /sign-up.
- "OTP expired" → same; resend.
- "PKCE code verifier missing" → opening the link in a different
  browser than the one that submitted /sign-up; ask the user to open
  in the original browser.

## Rollback

Both steps are reversible from the same dashboards. The code-only
parts (`/auth/callback/route.ts`, `emailRedirectTo` in the form) are
no-ops if the project isn't configured to send confirmation links;
nothing breaks.
