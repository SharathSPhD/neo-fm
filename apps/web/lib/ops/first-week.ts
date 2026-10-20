/** Pure aggregation for GET /api/admin/first-week: station signals by day plus a cost-per-listener-hour estimate. */

export interface SignalRow { user_id: string; kind: string; position_ms: number | null; created_at: string; }

export interface DayStats {
  listeners: number;
  plays: number;
  finishes: number;
  skips: number;
  likes: number;
  shares: number;
  skip_rate: number | null;
  finish_rate: number | null;
  /** Listening time we can see: position at finish or skip. Plays with no later finish/skip add nothing, so this is a floor. */
  listened_minutes: number;
}

export interface FirstWeek {
  window_days: number;
  totals: DayStats;
  by_day: Record<string, DayStats>;
  /** Listeners seen on more than one UTC day inside the window. */
  returning_listeners: number;
}

const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

function stats(rows: SignalRow[]): DayStats {
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  const plays = count("play");
  const finishes = count("finish");
  const skips = count("skip");
  const ms = rows.reduce((a, r) => a + ((r.kind === "finish" || r.kind === "skip") && r.position_ms ? r.position_ms : 0), 0);
  return {
    listeners: new Set(rows.map((r) => r.user_id)).size,
    plays, finishes, skips, likes: count("like"), shares: count("share"),
    skip_rate: ratio(skips, plays), finish_rate: ratio(finishes, plays),
    listened_minutes: Math.round(ms / 600) / 100,
  };
}

export function summarizeFirstWeek(rows: SignalRow[], windowDays: number): FirstWeek {
  const days = new Map<string, SignalRow[]>();
  const daysByUser = new Map<string, Set<string>>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    (days.get(day) ?? days.set(day, []).get(day)!).push(r);
    (daysByUser.get(r.user_id) ?? daysByUser.set(r.user_id, new Set()).get(r.user_id)!).add(day);
  }
  return {
    window_days: windowDays,
    totals: stats(rows),
    by_day: Object.fromEntries([...days].sort(([a], [b]) => a.localeCompare(b)).map(([d, rs]) => [d, stats(rs)])),
    returning_listeners: [...daysByUser.values()].filter((s) => s.size > 1).length,
  };
}

export interface CostPerHour {
  listener_hours: number;
  /** user_spend total (all months): Lyria reservations made by listeners' songs. Pool and lab renders run outside the app and are not in it. */
  ledger_gbp: number;
  admitted_pool_tracks: number;
  /** Admitted pool tracks times the per-render estimate (LYRIA_COST_GBP_FULL); an estimate, not billing data. */
  pool_estimate_gbp: number;
  ledger_gbp_per_listener_hour: number | null;
  pool_estimate_gbp_per_listener_hour: number | null;
}

export function costPerListenerHour(listenedMinutes: number, ledgerGbp: number, poolTracks: number, renderGbp: number): CostPerHour {
  const hours = listenedMinutes / 60;
  const pool = poolTracks * renderGbp;
  const per = (gbp: number) => (hours > 0 ? Math.round((gbp / hours) * 100) / 100 : null);
  return {
    listener_hours: Math.round(hours * 100) / 100,
    ledger_gbp: ledgerGbp,
    admitted_pool_tracks: poolTracks,
    pool_estimate_gbp: Math.round(pool * 100) / 100,
    ledger_gbp_per_listener_hour: per(ledgerGbp),
    pool_estimate_gbp_per_listener_hour: per(pool),
  };
}
