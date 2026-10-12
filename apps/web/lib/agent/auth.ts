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
