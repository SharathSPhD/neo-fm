# Google sign-in setup (≈10 minutes, free)

The app already ships a **Continue with Google** button (sign-in + sign-up). It stays hidden-safe: until the provider is enabled it shows
"Google sign-in is not available yet". You only need to create the Google client and paste it into Supabase.

## 1. Google Cloud (use the same project `neo-fm-511407`)
1. https://console.cloud.google.com/apis/credentials/consent → **External** → app name `neo-fm`, support email = yours,
   authorised domains: `neo-fm.com`, `technektar.com`, `supabase.co` → Save. (Publishing status can stay *Testing* while you try it;
   switch to *In production* before launch — scopes used are only `email`, `profile`, `openid`, so no verification review is needed.)
2. https://console.cloud.google.com/apis/credentials → **Create credentials → OAuth client ID → Web application**, name `neo-fm web`.
3. **Authorised redirect URIs** (add both; the second one is for the production Supabase project we create at cutover — I will tell you its ref):
   - `https://cjvwbyrarqgvxycrbgwx.supabase.co/auth/v1/callback`  ← dev/preview (now)
   - `https://<PROD_PROJECT_REF>.supabase.co/auth/v1/callback`  ← production (later)
4. Create → copy **Client ID** and **Client secret**.

## 2. Supabase (dev project `cjvwbyrarqgvxycrbgwx`)
Dashboard → Authentication → **Providers → Google** → enable → paste Client ID + Client secret → Save.
Dashboard → Authentication → **URL Configuration**:
- **Site URL**: `https://neo-fm.com` (at cutover; for now your stable preview alias is fine)
- **Redirect URLs** (allow list): `https://neo-fm.com/**`, `https://*.vercel.app/**`, `http://localhost:3000/**`

(That Site URL change also fixes confirmation-email links that currently point to localhost.)

## 3. Tell me "Google done"
I will then run the browser sign-in e2e against a preview (the Google consent screen itself cannot be automated; I verify the redirect to
`accounts.google.com`, the callback exchange with a Supabase-issued test session, and tier assignment for first-time OAuth users).
Never paste the client secret into chat.
