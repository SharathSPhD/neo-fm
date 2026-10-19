/**
 * Daily Lyria cap for scripts that render outside the app. Each reserve() counts one request through
 * POST /api/admin/provider-cap (batch class), so these renders share the day's 250-batch / 450-total limit with the pool,
 * lab and listener songs. Unlike the in-app cap this fails closed: a script spends real money and can simply be re-run.
 * Needs POOL_BASE_URL and the admin secret (env named by ADMIN_SECRET_ENV, default MA_PROD_ADMIN_SECRET).
 */
import type { DailyCap } from "../../apps/web/lib/ops/provider-cap";

export function remoteDailyCap(provider: "lyria" | "veo" | "tts" = "lyria", env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): DailyCap {
  const base = (env.POOL_BASE_URL ?? "").replace(/\/$/, "");
  const secret = env[env.ADMIN_SECRET_ENV ?? "MA_PROD_ADMIN_SECRET"];
  if (!base || !secret) throw new Error("daily cap: set POOL_BASE_URL and the admin secret (MA_PROD_ADMIN_SECRET) so renders count against the day's cap");
  return {
    async reserve() {
      const res = await f(`${base}/api/admin/provider-cap`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ provider, class: "batch" }),
      });
      if (res.status === 429) return false;
      if (!res.ok) throw new Error(`daily cap: provider-cap answered ${res.status}`);
      return true;
    },
  };
}
