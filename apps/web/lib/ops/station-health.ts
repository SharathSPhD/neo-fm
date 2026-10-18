/** Pure aggregation for GET /api/admin/station-health; the route only fetches rows and hands them here. */

/** Messages /station reports through /api/client-errors (one per page load at most, see report-client-error.ts). */
export const STATION_AUDIO_FAILED = "station: audio load failed";
export const STATION_QUEUE_EMPTY = "station: queue empty";

export interface StationSignalRow { user_id: string; kind: string; }
export interface StationErrorRow { message: string; }

export interface StationHealth {
  window_hours: number;
  signals: number;
  by_kind: Record<string, number>;
  listeners: number;
  signals_per_listener: number | null;
  plays: number;
  skip_rate: number | null;
  finish_rate: number | null;
  /** Page loads that hit a failed track / an empty queue. Counted once per page load, so these are floors. */
  audio_load_failures: number;
  queue_empty: number;
  audio_failure_rate: number | null;
  alerts: string[];
}

export const STATION_THRESHOLDS = { audioFailureRate: 0.1, minPlays: 10, skipRate: 0.7 };

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

export function summarizeStation(signals: StationSignalRow[], errors: StationErrorRow[], windowHours: number): StationHealth {
  const byKind: Record<string, number> = {};
  const users = new Set<string>();
  for (const s of signals) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    users.add(s.user_id);
  }
  const plays = byKind.play ?? 0;
  const failures = errors.filter((e) => e.message.startsWith(STATION_AUDIO_FAILED)).length;
  const empty = errors.filter((e) => e.message.startsWith(STATION_QUEUE_EMPTY)).length;
  const out: StationHealth = {
    window_hours: windowHours,
    signals: signals.length,
    by_kind: byKind,
    listeners: users.size,
    signals_per_listener: ratio(signals.length, users.size),
    plays,
    skip_rate: ratio(byKind.skip ?? 0, plays),
    finish_rate: ratio(byKind.finish ?? 0, plays),
    audio_load_failures: failures,
    queue_empty: empty,
    audio_failure_rate: ratio(failures, plays + failures),
    alerts: [],
  };
  const t = STATION_THRESHOLDS;
  if (plays + failures >= t.minPlays && out.audio_failure_rate! > t.audioFailureRate) {
    out.alerts.push(`station audio failures ${Math.round(out.audio_failure_rate! * 100)}% (${failures} failed vs ${plays} plays) in last ${windowHours}h`);
  }
  if (empty > 0) out.alerts.push(`station queue was empty ${empty} time(s) in last ${windowHours}h`);
  if (plays >= t.minPlays && out.skip_rate! > t.skipRate) {
    out.alerts.push(`station skip rate ${Math.round(out.skip_rate! * 100)}% over ${plays} plays`);
  }
  return out;
}
