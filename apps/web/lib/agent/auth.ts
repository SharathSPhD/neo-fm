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

export function checkBearer(header: string | null, env = process.env): AuthResult {
  const secret = cleanSecret(env.CRON_SECRET);
  const presented = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  const diag = { secret_configured: secret.length > 0, bearer_present: presented.length > 0 };
  if (!diag.secret_configured || !diag.bearer_present) return { ok: false, diag };
  const a = Buffer.from(secret);
  const b = Buffer.from(cleanSecret(presented));
  return { ok: a.length === b.length && timingSafeEqual(a, b), diag };
}
