/** Daily snapshot shaping and trend math. Pure; the routes do the I/O. */
import type { FunnelSummary } from "./funnel";
import type { HealthSummary } from "./health-summary";

export interface SnapshotRow { day: string; summary: HealthSummary; funnel: FunnelSummary | null }

export interface TrendPoint {
  day: string;
  jobs: number;
  failure_rate: number | null;
  p50_s: number | null;
  p90_s: number | null;
  oldest_queued_s: number | null;
  lyria_reserved_gbp: number | null;
  signups: number | null;
  landing_views: number | null;
  alerts: number;
}

/** User ids never need to be kept in history. */
export function stripForStorage(s: HealthSummary): HealthSummary {
  return { ...s, spend: { ...s.spend, top_users_this_month: [] } };
}

export function toPoint(r: SnapshotRow): TrendPoint {
  const jobs = Object.values(r.summary.counts).reduce((a, b) => a + b, 0);
  const failed = r.summary.counts.failed ?? 0;
  const lyria = r.summary.spend.global.find((g) => g.provider === "lyria");
  return {
    day: r.day,
    jobs,
    failure_rate: jobs > 0 ? Math.round((failed / jobs) * 1000) / 1000 : null,
    p50_s: r.summary.latency_s.p50,
    p90_s: r.summary.latency_s.p90,
    oldest_queued_s: r.summary.oldest_queued_age_s,
    lyria_reserved_gbp: lyria ? lyria.reserved_gbp : null,
    signups: r.funnel ? r.funnel.signups : null,
    landing_views: r.funnel ? r.funnel.views.landing_view : null,
    alerts: r.summary.alerts.length,
  };
}

/** Oldest first, so a chart reads left to right. */
export function buildTrend(rows: SnapshotRow[]): TrendPoint[] {
  return rows.map(toPoint).sort((a, b) => (a.day < b.day ? -1 : 1));
}
