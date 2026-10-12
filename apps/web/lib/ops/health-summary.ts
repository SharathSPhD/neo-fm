/** Pure aggregation for GET /api/admin/health-summary; the route only fetches rows and hands them here. */

export interface JobRow {
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
export interface DictionRow {
  language: string | null;
  diction_qa: { matchPct?: number; error?: string } | null;
}
export interface SpendInput {
  global: { provider: string; reserved_gbp: number }[];
  topUsersThisMonth: { user_id: string; reserved_gbp: number }[];
}

export interface HealthSummary {
  generated_at: string;
  window_hours: number;
  counts: Record<string, number>;
  oldest_queued_age_s: number | null;
  failures_by_code: Record<string, number>;
  latency_s: { n: number; p50: number | null; p90: number | null; p95: number | null; max: number | null };
  diction_by_language: Record<string, { n: number; avg_match_pct: number | null; errors: number }>;
  spend: { global: SpendInput["global"]; top_users_this_month: SpendInput["topUsersThisMonth"] };
  alerts: string[];
}

export const THRESHOLDS = { queuedAgeS: 600, failureRate: 0.2, minJobsForRate: 5, p90S: 900 };

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

const secs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 1000;

/** Failure text can carry ids or provider detail; keep only a short code-like head. */
export function failureCode(error: string | null): string {
  const head = (error ?? "unknown").split(/[:\n]/)[0]!.trim().toLowerCase().replace(/[^a-z0-9_ -]/g, "").slice(0, 40);
  return head || "unknown";
}

export function buildAlerts(s: Omit<HealthSummary, "alerts">): string[] {
  const out: string[] = [];
  if (s.oldest_queued_age_s !== null && s.oldest_queued_age_s > THRESHOLDS.queuedAgeS) {
    out.push(`queue stuck: oldest queued job is ${Math.round(s.oldest_queued_age_s / 60)} min old`);
  }
  const failed = s.counts.failed ?? 0;
  const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
  if (total >= THRESHOLDS.minJobsForRate && failed / total > THRESHOLDS.failureRate) {
    out.push(`failure rate ${Math.round((failed / total) * 100)}% (${failed}/${total}) in last ${s.window_hours}h`);
  }
  if (s.latency_s.p90 !== null && s.latency_s.p90 > THRESHOLDS.p90S) {
    out.push(`p90 latency ${Math.round(s.latency_s.p90 / 60)} min over ${s.latency_s.n} songs`);
  }
  return out;
}

export function summarize(
  jobs: JobRow[], diction: DictionRow[], spend: SpendInput, now: Date = new Date(), windowHours = 24,
): HealthSummary {
  const counts: Record<string, number> = {};
  const failures: Record<string, number> = {};
  const lat: number[] = [];
  let oldestQueued: number | null = null;
  for (const j of jobs) {
    counts[j.status] = (counts[j.status] ?? 0) + 1;
    if (j.status === "failed") { const c = failureCode(j.error); failures[c] = (failures[c] ?? 0) + 1; }
    if (j.status === "queued") {
      const age = secs(j.created_at, now.toISOString());
      if (oldestQueued === null || age > oldestQueued) oldestQueued = age;
    }
    if (j.status === "completed" && j.finished_at) lat.push(secs(j.created_at, j.finished_at));
  }
  lat.sort((a, b) => a - b);
  const byLang: HealthSummary["diction_by_language"] = {};
  const sums: Record<string, number> = {};
  for (const d of diction) {
    const l = d.language ?? "unknown";
    const e = (byLang[l] ??= { n: 0, avg_match_pct: null, errors: 0 });
    if (typeof d.diction_qa?.matchPct === "number") { e.n++; sums[l] = (sums[l] ?? 0) + d.diction_qa.matchPct; }
    else if (d.diction_qa?.error) e.errors++;
  }
  for (const [l, e] of Object.entries(byLang)) e.avg_match_pct = e.n ? Math.round((sums[l]! / e.n) * 10) / 10 : null;
  const base = {
    generated_at: now.toISOString(),
    window_hours: windowHours,
    counts,
    oldest_queued_age_s: oldestQueued === null ? null : Math.round(oldestQueued),
    failures_by_code: failures,
    latency_s: {
      n: lat.length,
      p50: percentile(lat, 50), p90: percentile(lat, 90), p95: percentile(lat, 95),
      max: lat.length ? lat[lat.length - 1]! : null,
    },
    diction_by_language: byLang,
    spend: { global: spend.global, top_users_this_month: spend.topUsersThisMonth },
  };
  return { ...base, alerts: buildAlerts(base) };
}

/** One line for the routine to post; "OK" when nothing needs attention. */
export function alertString(s: HealthSummary): string {
  const c = s.counts;
  const head = `neo-fm ${s.window_hours}h: ${c.completed ?? 0} done, ${c.failed ?? 0} failed, ${c.queued ?? 0} queued, ${c.processing ?? 0} processing`;
  return s.alerts.length ? `ALERT ${head} | ${s.alerts.join("; ")}` : `OK ${head}`;
}
