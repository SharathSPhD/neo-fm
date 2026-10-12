import { timingSafeEqual } from "node:crypto";

export interface AuthResult {
  ok: boolean;
  /** Non-secret booleans only, to tell "not configured" from "mismatch" without leaking anything. */
  diag: { secret_configured: boolean; bearer_present: boolean };
}

/** Env values pasted into dashboards often carry stray whitespace or wrapping quotes. */
export function cleanSecret(v: string | undefined): string {
  return (v ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

/**
 * Accepts CRON_SECRET (Vercel Cron / operators) or AGENT_TICK_SECRET (a separate,
 * independently rotatable secret for manual and automated callers).
 */
export function checkBearer(header: string | null, env = process.env): AuthResult {
  const secrets = [cleanSecret(env.CRON_SECRET), cleanSecret(env.AGENT_TICK_SECRET)].filter((s) => s.length > 0);
  const presented = cleanSecret((header ?? "").replace(/^Bearer\s+/i, ""));
  const diag = { secret_configured: secrets.length > 0, bearer_present: presented.length > 0 };
  if (!diag.secret_configured || !diag.bearer_present) return { ok: false, diag };
  const b = Buffer.from(presented);
  let ok = false;
  for (const secret of secrets) {
    const a = Buffer.from(secret);
    // Evaluate every candidate so timing does not reveal which secret matched.
    ok = (a.length === b.length && timingSafeEqual(a, b)) || ok;
  }
  return { ok, diag };
}

/**
 * Admin routes (setup, probes, evals, reports). When ADMIN_SECRET is set it is the ONLY accepted secret, so the
 * cron/tick secrets cannot reach admin power. While it is unset this falls back to checkBearer so existing
 * operator tooling keeps working until the env var is provisioned.
 */
export function checkAdminBearer(header: string | null, env = process.env): AuthResult {
  const admin = cleanSecret(env.ADMIN_SECRET);
  if (!admin) return checkBearer(header, env);
  return checkBearer(header, { ADMIN_SECRET: undefined, CRON_SECRET: admin, AGENT_TICK_SECRET: undefined } as unknown as NodeJS.ProcessEnv);
}
