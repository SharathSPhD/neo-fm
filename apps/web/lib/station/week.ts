/**
 * "Your week on neo-fm": a listener's own last seven days on the station, from their station_signals. Pure aggregation
 * (the I/O is in ./week-load.ts) so the rules are unit-testable. Nothing here is stored: it is recomputed on request from
 * the listener's own rows, so there is no new personal data to protect or delete. Off unless STATION_WEEK=1.
 */
export interface WeekSignal {
  trackId: string;
  kind: string;
  createdAt: string;
  positionMs: number | null;
}

export interface WeekTrack {
  title: string | null;
  language: string;
  genre: string | null;
  mood: string[];
  durationSeconds: number | null;
}

export interface Week {
  /** The window, ISO instants, both ends inclusive. */
  start: string;
  end: string;
  empty: boolean;
  plays: number;
  finishes: number;
  skips: number;
  likes: number;
  shares: number;
  replays: number;
  distinctTracks: number;
  /** Rough minutes of listening: finished tracks at full length, skipped ones up to where the listener left. */
  minutes: number;
  /** Days (India time) with at least one play, out of 7. */
  activeDays: number;
  /** Consecutive active days ending today or yesterday. */
  streak: number;
  languages: Array<{ language: string; weight: number }>;
  moods: Array<{ mood: string; weight: number }>;
  favourite: { trackId: string; title: string | null; language: string; genre: string | null } | null;
}

export const WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;
/** Used when a pool row has no duration yet. */
const DEFAULT_TRACK_SECONDS = 150;

export function weekEnabled(): boolean {
  return process.env.STATION_WEEK === "1";
}

/** How strongly a signal says "this is mine". Plays and skips carry no taste on their own. */
const WEIGHT: Record<string, number> = { finish: 1, replay: 1, like: 2, share: 2 };

const istDay = (ms: number) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS);

export function weekRange(now: number = Date.now()): { start: string; end: string } {
  return { start: new Date(now - WEEK_DAYS * DAY_MS).toISOString(), end: new Date(now).toISOString() };
}

export function buildWeek(signals: WeekSignal[], tracks: Record<string, WeekTrack>, now: number = Date.now()): Week {
  const { start, end } = weekRange(now);
  const from = Date.parse(start);
  const rows = signals.filter((s) => {
    const t = Date.parse(s.createdAt);
    return Number.isFinite(t) && t >= from && t <= now;
  });

  const count = (kind: string) => rows.filter((s) => s.kind === kind).length;
  const seen = new Set(rows.map((s) => s.trackId));
  const dayHits = new Set(rows.filter((s) => s.kind === "play").map((s) => istDay(Date.parse(s.createdAt))));

  let seconds = 0;
  const lang: Record<string, number> = {};
  const mood: Record<string, number> = {};
  const byTrack = new Map<string, { weight: number; last: number }>();
  for (const s of rows) {
    const tr = tracks[s.trackId];
    if (s.kind === "finish") seconds += tr?.durationSeconds ?? DEFAULT_TRACK_SECONDS;
    else if (s.kind === "skip" && s.positionMs) seconds += Math.min(s.positionMs / 1000, tr?.durationSeconds ?? DEFAULT_TRACK_SECONDS);
    const w = WEIGHT[s.kind] ?? 0;
    if (!w || !tr) continue;
    lang[tr.language] = (lang[tr.language] ?? 0) + w;
    for (const m of tr.mood) mood[m] = (mood[m] ?? 0) + w;
    const cur = byTrack.get(s.trackId) ?? { weight: 0, last: 0 };
    byTrack.set(s.trackId, { weight: cur.weight + w, last: Math.max(cur.last, Date.parse(s.createdAt)) });
  }

  const rank = <K extends string>(m: Record<string, number>, key: K) =>
    Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, weight]) => ({ [key]: k, weight }) as Record<K, string> & { weight: number });

  const best = [...byTrack.entries()].sort((a, b) => b[1].weight - a[1].weight || b[1].last - a[1].last)[0];
  const bestTrack = best ? tracks[best[0]] : undefined;

  const today = istDay(now);
  let streak = 0;
  for (let d = dayHits.has(today) ? today : today - 1; dayHits.has(d); d--) streak++;

  return {
    start,
    end,
    empty: rows.length === 0,
    plays: count("play"),
    finishes: count("finish"),
    skips: count("skip"),
    likes: count("like"),
    shares: count("share"),
    replays: count("replay"),
    distinctTracks: seen.size,
    minutes: Math.round(seconds / 60),
    activeDays: dayHits.size,
    streak,
    languages: rank(lang, "language").slice(0, 3),
    moods: rank(mood, "mood").slice(0, 3),
    favourite: best && bestTrack ? { trackId: best[0], title: bestTrack.title, language: bestTrack.language, genre: bestTrack.genre } : null,
  };
}
