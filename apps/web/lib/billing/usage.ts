/**
 * Plan-usage helpers for /account. Quota and the Lyria allowance both reset on the first of the month (UTC):
 * `user_jobs_count_month` counts completed jobs since date_trunc('month', now() at time zone 'utc') and
 * `user_spend.period` is the month's first day, so one reset date serves both.
 */
export function nextMonthlyReset(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function startOfMonthIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface UsageSummary {
  quota: number;
  used: number;
  left: number;
  /** 0..1, clamped, for the meter bar. */
  fraction: number;
}

export function summarizeUsage(quota: number, used: number): UsageSummary {
  const q = Math.max(0, Math.floor(quota));
  const u = Math.max(0, Math.floor(used));
  return { quota: q, used: u, left: Math.max(0, q - u), fraction: q === 0 ? 1 : Math.min(1, u / q) };
}

/** The developer tier is stored as 999999; showing "999,999 left" is noise. */
export function isEffectivelyUnlimited(quota: number): boolean {
  return quota >= 100_000;
}
