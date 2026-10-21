/**
 * Lake curation (strategy/station-pass-and-lake.md): scores each admitted pool track from what we know about it so the
 * next fill can replace the weak ones. Pure functions; /api/admin/lake-curation reads the rows and calls these.
 * Real listeners are few today, so intrinsic quality (diction, judge) counts as much as listener signals, and a track
 * with no signals is never flagged for them.
 */
export interface CurationTrack {
  id: string;
  title: string | null;
  language: string;
  genre: string | null;
  energy: string | null;
  diction_u: number | null;
  /** Advisory free local-ASR read (DICTION_LOCAL_PREFILTER); only consulted when there is no Gemini diction score. */
  local_diction_u?: number | null;
  judge_overall: number | null;
  duration_seconds: number | null;
}

export interface TrackSignals { plays: number; skips: number; finishes: number; likes: number; replays: number; shares: number }
export const NO_SIGNALS: TrackSignals = { plays: 0, skips: 0, finishes: 0, likes: 0, replays: 0, shares: 0 };

export type CurationFlag = "low-diction" | "low-judge" | "skipped" | "reported" | "too-short" | "unscored" | "local-low";
export type Verdict = "keep" | "watch" | "replace";

export interface CuratedTrack extends CurationTrack {
  score: number;
  flags: CurationFlag[];
  verdict: Verdict;
  signals: TrackSignals;
  reports: number;
}

/** Admission needs 80; below this a pass is still thin and the track is a replacement candidate. */
export const LOW_DICTION = 85;
export const LOW_JUDGE = 3;
/** Local-ASR read below this on an otherwise unscored track is a watch flag, never a replace on its own (advisory scorer). */
export const LOCAL_LOW = 50;
/** Skip rate only counts once a track has this many plays; below that it is noise. */
export const MIN_PLAYS = 5;
export const SKIP_RATE = 0.5;
export const SHORT_SECONDS = 30;

export function curateTrack(t: CurationTrack, s: TrackSignals = NO_SIGNALS, reports = 0): CuratedTrack {
  const flags: CurationFlag[] = [];
  if (t.diction_u === null && t.judge_overall === null) flags.push("unscored");
  if (t.diction_u === null && typeof t.local_diction_u === "number" && t.local_diction_u < LOCAL_LOW) flags.push("local-low");
  if (t.diction_u !== null && t.diction_u < LOW_DICTION) flags.push("low-diction");
  if (t.judge_overall !== null && t.judge_overall < LOW_JUDGE) flags.push("low-judge");
  if (s.plays >= MIN_PLAYS && s.skips / s.plays >= SKIP_RATE) flags.push("skipped");
  if (reports > 0) flags.push("reported");
  if (t.duration_seconds !== null && t.duration_seconds > 0 && t.duration_seconds < SHORT_SECONDS) flags.push("too-short");
  // 0-100: diction and judge carry the base, listeners move it up or down once there is any signal.
  const base = (t.diction_u ?? 80) * 0.6 + ((t.judge_overall ?? 3.5) / 5) * 100 * 0.4;
  const liked = s.likes * 4 + s.shares * 3 + s.replays * 2 + s.finishes;
  const score = Math.max(0, Math.min(100, Math.round((base + Math.min(10, liked) - (s.plays >= MIN_PLAYS ? (s.skips / s.plays) * 15 : 0) - reports * 20) * 10) / 10));
  const hard = flags.includes("reported") || flags.includes("skipped") || flags.includes("too-short");
  const verdict: Verdict = hard || flags.length >= 2 ? "replace" : flags.length === 1 ? "watch" : "keep";
  return { ...t, score, flags, verdict, signals: s, reports };
}

export interface CellSummary { genre: string; energy: string; tracks: number }

/** genre x energy counts for one language, fewest first, so the next fill targets the thin cells. */
export function cellSummary(tracks: readonly CurationTrack[]): CellSummary[] {
  const m = new Map<string, CellSummary>();
  for (const t of tracks) {
    const genre = t.genre ?? "untagged";
    const energy = t.energy ?? "untagged";
    const k = `${genre}|${energy}`;
    m.set(k, { genre, energy, tracks: (m.get(k)?.tracks ?? 0) + 1 });
  }
  return [...m.values()].sort((a, b) => a.tracks - b.tracks || a.genre.localeCompare(b.genre));
}

export function curateLake(
  tracks: readonly CurationTrack[],
  signals: ReadonlyMap<string, TrackSignals>,
  reports: ReadonlyMap<string, number>,
): { languages: Record<string, { total: number; keep: number; watch: number; replace: number; cells: CellSummary[]; tracks: CuratedTrack[] }> } {
  const languages: Record<string, { total: number; keep: number; watch: number; replace: number; cells: CellSummary[]; tracks: CuratedTrack[] }> = {};
  for (const lang of new Set(tracks.map((t) => t.language))) {
    const own = tracks.filter((t) => t.language === lang);
    const curated = own.map((t) => curateTrack(t, signals.get(t.id), reports.get(t.id) ?? 0)).sort((a, b) => a.score - b.score);
    languages[lang] = {
      total: curated.length,
      keep: curated.filter((t) => t.verdict === "keep").length,
      watch: curated.filter((t) => t.verdict === "watch").length,
      replace: curated.filter((t) => t.verdict === "replace").length,
      cells: cellSummary(own),
      tracks: curated,
    };
  }
  return { languages };
}
