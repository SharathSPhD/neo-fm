/**
 * "My month in music": pure aggregation over a user's own songs and the
 * aggregate reactions they received. No I/O here (see ./load.ts), so the
 * rules are unit-testable.
 */

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface MonthRange {
  /** "YYYY-MM" in India time (what the user thinks of as "this month"). */
  month: string;
  /** Inclusive start, exclusive end, as ISO instants. */
  start: string;
  end: string;
}

/** Calendar month in IST. Undefined for malformed input or a month that hasn't started yet. */
export function monthRange(month: string, now: Date = new Date()): MonthRange | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 2024) return null;
  const start = Date.UTC(y, mo - 1, 1) - IST_OFFSET_MS;
  const end = Date.UTC(y, mo, 1) - IST_OFFSET_MS;
  if (start > now.getTime()) return null;
  return { month, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** Current month in IST as "YYYY-MM". */
export function currentMonth(now: Date = new Date()): string {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface RecapSong {
  id: string;
  title: string;
  language: string;
  style_family: string;
  created_at: string;
  /** mood:* tags found on the song's sections, lowercase, without the prefix. */
  moods: string[];
}

export interface RecapInput {
  /** Completed songs created in the month. */
  songs: RecapSong[];
  /** Likes received in the month, per song id (other people only). */
  likes: Record<string, number>;
  /** Distinct other listeners (>= 70% played) in the month, per song id. */
  listeners: Record<string, number>;
  collectionsCreated: number;
  songsCollected: number;
}

export interface Recap {
  songs: number;
  languages: { code: string; count: number }[];
  styles: { code: string; count: number }[];
  moods: { mood: string; count: number }[];
  topSong: { id: string; title: string; language: string; likes: number; listens: number } | null;
  likes: number;
  listens: number;
  collections: { created: number; added: number };
}

function tally(values: string[]): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Pulls `mood:*` tags from a Song Document's sections. Tolerant of any shape. */
export function extractMoods(documentJson: unknown): string[] {
  const out = new Set<string>();
  const sections = (documentJson as { sections?: unknown } | null)?.sections;
  if (Array.isArray(sections)) {
    for (const s of sections) {
      const tags = (s as { tags?: unknown } | null)?.tags;
      if (!Array.isArray(tags)) continue;
      for (const t of tags) {
        if (typeof t !== "string") continue;
        const mm = /^mood:([a-z][a-z -]{0,30})$/i.exec(t.trim());
        if (mm) out.add(mm[1]!.toLowerCase());
      }
    }
  }
  return [...out];
}

export function buildRecap(input: RecapInput): Recap {
  const { songs } = input;
  const ids = new Set(songs.map((s) => s.id));
  // Reactions count for songs made this month, so the top song is one the user can also see in this month's list.
  const likeOf = (id: string) => input.likes[id] ?? 0;
  const listenOf = (id: string) => input.listeners[id] ?? 0;
  let top: RecapSong | null = null;
  let topScore = 0;
  for (const s of songs) {
    // Likes weigh more than a listen: same ordering idea as the discovery charts.
    const score = likeOf(s.id) * 3 + listenOf(s.id);
    if (score > topScore) {
      top = s;
      topScore = score;
    }
  }
  return {
    songs: songs.length,
    languages: tally(songs.map((s) => s.language)).map((x) => ({ code: x.key, count: x.count })),
    styles: tally(songs.map((s) => s.style_family)).map((x) => ({ code: x.key, count: x.count })),
    moods: tally(songs.flatMap((s) => s.moods)).slice(0, 5).map((x) => ({ mood: x.key, count: x.count })),
    topSong: top ? { id: top.id, title: top.title, language: top.language, likes: likeOf(top.id), listens: listenOf(top.id) } : null,
    likes: [...ids].reduce((n, id) => n + likeOf(id), 0),
    listens: [...ids].reduce((n, id) => n + listenOf(id), 0),
    collections: { created: input.collectionsCreated, added: input.songsCollected },
  };
}
