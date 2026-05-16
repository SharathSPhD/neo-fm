<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Legacy anon, service_role API keys are they still needed

Yes, legacy anon and service_role API keys are still in use, but it is strongly recommended to migrate to new publishable and secret API keys. The legacy keys are HS256-signed JWTs that have a long expiry of 10 years, making them difficult to rotate or expire.
If you haven't migrated to asymmetric JWT signing keys, you should consider doing so, as it is no longer possible to rotate the legacy anon, service, and JWT secrets. Migrating to asymmetric JWT signing keys and using publishable/secret API keys enhances your security setup.
give a detailed instruction on how to use jwt keys and if it is accessible via supabase mcp in cursor

Yes, legacy `anon` and `service_role` API keys still work, but Supabase strongly recommends migrating to the **new publishable/secret API keys** backed by **asymmetric JWT signing keys** for better security and key‑rotation.[^1][^2][^3][^4]

Below is a concise, step‑by‑step that you can follow:

***

### 1. Understand the new API‑key model

- **Publishable key (`sb_publishable_...`)**
Replaces the old `anon` key. Used in clients (e.g., frontend) to talk to Supabase Auth, RLS‑guarded tables, etc.[^3][^5][^1]
- **Secret key (`sb_secret_...`)**
Replaces `service_role`. Used in backend / server‑side code where you need full‑table access or admin‑style operations.[^6][^3]
- Both keys are **opaque** (not JWTS themselves) and are internally converted into short‑lived JWTs by Supabase.[^5][^3]

Legacy keys are still accepted during migration, and you can keep them active while you roll out the new keys.[^2][^7]

***

### 2. Migrate to asymmetric JWT signing keys (dashboard)

Do this once per project; it makes future key rotation safe and easy.[^7][^4]

1. Go to your Supabase project dashboard → **Auth → JWT Signing Keys**.[^4]
2. Click **“Migrate JWT secret”** (this imports your existing legacy JWT secret into the new system and creates a new asymmetric key pair).
3. Mark the new asymmetric key as **“standby”**, then later **“activate”** it when you’re ready to rotate.[^7][^4]
4. Once you’ve verified everything works, you can **revoke the old legacy JWT secret**; after that, any JWTs signed with it will be rejected.[^4][^7]

At this point your Supabase Auth JWTs are being signed with the new asymmetric key (RSA/ECDSA), and you can get the public keys from the JWKS endpoint.[^5][^7][^4]

***

### 3. Use JWTs with your backend (verification)

If your backend code (e.g., Node/Python) needs to validate Supabase‑issued JWTs (for RLS‑aware middleware, custom APIs, etc.), you should:

1. Read the JWT from the `Authorization: Bearer ...` header.[^5]
2. Fetch the public keys from Supabase’s JWKS:
    - Endpoint: `https://<project-ref>.supabase.co/auth/v1/.well‑known/jwks.json`.[^4][^5]
3. Use a library like `jose` (Node) or `jose`/`pyjwt` with JWKS support to verify the signature using the public key.

Example (Node pattern, taken from Supabase docs):[^5]

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

const PROJECT_JWKS = createRemoteJWKSet(
  new URL('https://PROJECT-REF.supabase.co/auth/v1/.well-known/jwks.json')
)

async function verifyProjectJWT(jwt: string) {
  return jwtVerify(jwt, PROJECT_JWKS)
}
```

This is the **modern way** to verify Supabase JWTs instead of trying to re‑sign them with your own symmetric secret.[^8][^7][^5]

***

### 4. Using new API keys in client code

The migration is largely a **search‑replace**:

- Client‑side (e.g., Supabase JS):
    - Old: `supabase.createClient(url, ANON_KEY)`
    - New: `supabase.createClient(url, PUBLISHABLE_KEY)`
    - The `supabase-js` client will automatically use the publishable key to obtain short‑lived JWTs for Auth and RLS‑protected APIs.[^1][^5]
- Server‑side (Edge functions, backend APIs):
    - Use `sb_secret_...` anywhere you previously used `service_role`.[^3][^6]

You can create multiple secret keys and rotate them independently, because they’re opaque and not tied to one long‑lived secret.[^6][^3]

***

### 5. Are JWT API keys accessible via Supabase MCP in Cursor?

The **Supabase MCP server** (Model Context Protocol) is a separate service that connects Cursor / MCP‑compatible IDEs to your Supabase project for things like table introspection, config reading, and database‑aware LLM tooling.[^9][^10]

- The MCP server itself is configured with a **personal access token** (PAT) from your Supabase account, not directly with `anon`/`service_role` or the new publishable/secret keys.[^11][^9]
- Example MCP config in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "<your-personal-access-token>"
      ]
    }
  }
}
```

The MCP server uses this PAT to talk to the Supabase management API and then internally handles authentication to your project (often via the project’s `anon` or API‑key‑based endpoints).[^9][^11]
- So, **you do not directly expose your JWT‑based API keys (legacy or new) to Cursor**; instead, MCP talks to Supabase via your PAT and your project’s API‑key configuration.[^10][^11][^9]

If you want MCP‑enabled tools to run queries, those queries still run under the permissions of the API key (publishable vs secret) that your backend / Supabase‑client config exposes, but **Cursor itself interacts via the MCP server and PAT, not by injecting your JWT keys into the editor UI**.[^10][^9]

***

### 6. Practical migration checklist

- [ ] In dashboard, enable **new API keys** and generate `sb_publishable_...` and `sb_secret_...`.[^3]
- [ ] Migrate to **asymmetric JWT signing keys** under **Auth → JWT Signing Keys**.[^7][^4]
- [ ] In client code, replace `ANON_KEY` with the publishable key; in backend, replace `SERVICE_ROLE_KEY` with a secret key.[^3][^5]
- [ ] Update any custom JWT‑verification code to trust the JWKS endpoint, not a hardcoded HS256 secret.[^8][^7][^5]
- [ ] Keep legacy `anon`/`service_role` active until you’re confident the new keys are fully rolled out, then disable/revoke them.[^2][^7]

***

If you tell me what stack you’re on (e.g., Next.js frontend + Node backend, Python FastAPI, etc.), I can give you a concrete code snippet tailored to your stack showing how to:

- wire up the new publishable/secret keys, and
- verify Supabase JWTs using the JWKS endpoint.
<span style="display:none">[^12][^13][^14][^15]</span>

<div align="center">⁂</div>

[^1]: https://supabase.com/docs/guides/getting-started/api-keys

[^2]: https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd

[^3]: https://supabase.com/changelog/29260-upcoming-changes-to-supabase-api-keys

[^4]: https://supabase.com/docs/guides/auth/signing-keys

[^5]: https://supabase.com/docs/guides/auth/jwts

[^6]: https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys

[^7]: https://supabase.com/blog/jwt-signing-keys

[^8]: https://objectgraph.com/blog/migrating-supabase-jwt-jwks/

[^9]: https://supabase.com/blog/mcp-server

[^10]: https://composio.dev/toolkits/supabase/framework/cursor

[^11]: https://github.com/supabase-community/supabase-mcp/issues/117

[^12]: https://github.com/orgs/supabase/discussions/40300

[^13]: https://www.reddit.com/r/Supabase/comments/1q1wtzm/how_do_i_change_service_role_key/

[^14]: https://zazencodes.substack.com/p/supabase-mcp-with-cursor-step-by

[^15]: https://supabase.nuxtjs.org/getting-started/migration

