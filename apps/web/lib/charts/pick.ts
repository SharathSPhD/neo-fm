/** Pure chart helpers (client-safe, no I/O). */

export interface ChartSong {
  public_id: string;
  title: string | null;
  language: string;
  style_family: string;
  likes: number;
  listeners: number;
  shares: number;
  score: number;
}

export const CHART_LANGS = ["hi", "ta", "te", "kn", "bn", "en"] as const;

export function normalizeChartLang(raw: string | undefined): string | null {
  return raw && (CHART_LANGS as readonly string[]).includes(raw) ? raw : null;
}

/** Days since the Unix epoch in UTC; the daily rotation key. */
export function utcDayNumber(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/**
 * Song of the day: rotates through the week's top 5 by UTC date so it is
 * stable all day, changes tomorrow, and can't be bought with a one-day
 * burst (the chart itself is a 7-day window with per-user caps).
 */
export function pickSongOfTheDay(
  chart: ChartSong[],
  now: Date = new Date(),
): ChartSong | null {
  const pool = chart.slice(0, 5);
  if (pool.length === 0) return null;
  return pool[utcDayNumber(now) % pool.length] ?? null;
}
