/**
 * Pure analysis for the daily spend-leak monitor (route: /api/admin/spend-monitor).
 *
 * reserve_user_spend() adds to user_spend.reserved_gbp and nothing marks a reservation as "settled": on success the
 * reservation simply stays as spend, and only a failed render calls release_user_spend(). So there is no per-reservation
 * row to age out. A leak is therefore inferred: a user's reserved_gbp for the month that the month's Lyria calls cannot
 * account for, even at the full-song price. Stale = runs that were claimed but have not moved for a long time, which
 * may be holding a reservation that a crashed worker never released.
 */

export interface UserSpendRow { user_id: string; reserved_gbp: number }
export interface RunRow { job_id: string; user_id: string; status: string; lyria_calls: number; updated_at: string }

export interface SpendThresholds {
  clipCostGbp: number;
  fullCostGbp: number;
  globalCapGbp: number;
  staleRunMinutes: number;
  /** Warn when global reserved crosses this fraction of the cap. */
  warnFraction: number;
}

export interface UserLeak {
  user_id: string;
  reserved_gbp: number;
  /** Lyria calls in this month's runs; each reserved at clip..full price. */
  lyria_calls: number;
  /** reserved minus the most the calls could have cost: a certain leak (>0). */
  leaked_gbp_min: number;
  /** reserved minus the least the calls could have cost: a possible leak, upper bound. */
  leaked_gbp_max: number;
}

export interface SpendReport {
  period: string;
  globalCapGbp: number;
  globalReservedGbp: number;
  globalUsedFraction: number;
  userCount: number;
  leaks: UserLeak[];
  leakedGbpMin: number;
  staleRuns: { job_id: string; user_id: string; status: string; age_minutes: number; lyria_calls: number }[];
  alerts: string[];
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function analyseSpend(
  period: string, users: UserSpendRow[], runs: RunRow[], t: SpendThresholds, now = new Date(),
): SpendReport {
  const calls = new Map<string, number>();
  for (const r of runs) calls.set(r.user_id, (calls.get(r.user_id) ?? 0) + Math.max(0, r.lyria_calls));

  const leaks: UserLeak[] = [];
  for (const u of users) {
    const n = calls.get(u.user_id) ?? 0;
    const min = r4(u.reserved_gbp - n * t.fullCostGbp);
    const max = r4(u.reserved_gbp - n * t.clipCostGbp);
    // Float slack of half a clip: below that the difference is just estimate drift, not a leak.
    if (min > t.clipCostGbp / 2) leaks.push({ user_id: u.user_id, reserved_gbp: u.reserved_gbp, lyria_calls: n, leaked_gbp_min: min, leaked_gbp_max: max });
  }
  leaks.sort((a, b) => b.leaked_gbp_min - a.leaked_gbp_min);

  const staleRuns = runs
    .filter((r) => (r.status === "pending" || r.status === "running"))
    .map((r) => ({ job_id: r.job_id, user_id: r.user_id, status: r.status, lyria_calls: r.lyria_calls, age_minutes: Math.round((now.getTime() - new Date(r.updated_at).getTime()) / 60_000) }))
    .filter((r) => r.age_minutes >= t.staleRunMinutes)
    .sort((a, b) => b.age_minutes - a.age_minutes);

  const globalReservedGbp = r4(users.reduce((s, u) => s + u.reserved_gbp, 0));
  const globalUsedFraction = t.globalCapGbp > 0 ? r4(globalReservedGbp / t.globalCapGbp) : 0;
  const leakedGbpMin = r4(leaks.reduce((s, l) => s + l.leaked_gbp_min, 0));

  const alerts: string[] = [];
  if (globalUsedFraction >= 1) alerts.push(`Global Lyria budget exhausted: £${globalReservedGbp} of £${t.globalCapGbp}`);
  else if (globalUsedFraction >= t.warnFraction) alerts.push(`Global Lyria budget at ${Math.round(globalUsedFraction * 100)}%: £${globalReservedGbp} of £${t.globalCapGbp}`);
  if (leaks.length) alerts.push(`${leaks.length} user(s) hold at least £${leakedGbpMin} of reservations no render accounts for`);
  if (staleRuns.length) alerts.push(`${staleRuns.length} run(s) pending/running for over ${t.staleRunMinutes} min`);

  return { period, globalCapGbp: t.globalCapGbp, globalReservedGbp, globalUsedFraction, userCount: users.length, leaks, leakedGbpMin, staleRuns, alerts };
}
