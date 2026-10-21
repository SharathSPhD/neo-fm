/**
 * Station ranking v1: tag rules plus the listener's own recent signals, an exploration bonus for unheard tracks, and per-language finish ratio and mix. No ML, no embeddings, and no claim of
 * personalisation beyond what is scored here: a track gains for tags and languages the listener liked or
 * finished, loses for ones they skipped, and is pushed down after it was just heard.
 */
export interface PoolTrack {
  id: string;
  language: string;
  tags: string[];
  /** Stand-in for a prompt/artist-style family until pool rows carry one: tracks sharing it should not play close together. */
  family?: string;
  /** Tagger energy band (pool_tracks.energy, migration 0096); absent or null means "derive it from tags". */
  energy?: "low" | "mid" | "high" | null;
  /** Parts of the day the tagger says this track suits (pool_tracks.daypart); absent or empty means "derive it from tags". */
  daypart?: readonly string[];
  /** Migration 0100: instrumentals ('zxx', no vocals) are language-neutral. Absent means vocal. */
  kind?: "vocal" | "instrumental";
  durationSeconds?: number | null;
  /** Migration 0104: lead voice from the voice judge. Absent or null means untagged; programming then ignores voice. */
  voice?: "female" | "male" | "mixed" | null;
}

export type StationSignalKind = "play" | "like" | "skip" | "replay" | "share" | "finish";

export interface StationSignal {
  trackId: string;
  kind: StationSignalKind;
  /** Milliseconds since the signal happened. */
  ageMs: number;
}

export interface RankOptions {
  /** Language the listener asked for (hard filter when given and the pool has any). */
  language?: string | null;
  /** Occasion/mood tags the listener picked; each matching tag adds a flat bonus. */
  wantTags?: string[];
  limit?: number;
  /** Deterministic jitter source so a station does not repeat the same order; tests pass a fixed one. */
  random?: () => number;
  /** Extra score per track from a saved taste profile (lib/station/taste-bias.ts); a bounded cold-start prior. */
  prior?: (t: PoolTrack) => number;
}

const HALF_LIFE_MS = 14 * 86_400_000;
const WEIGHT: Record<StationSignalKind, number> = { like: 3, share: 2, replay: 2, finish: 1, play: 0, skip: -2 };
const RECENT_PLAY_MS = 6 * 3_600_000;
/** A track the listener has no signal on at all gets a nudge, so the station keeps exploring instead of replaying favourites. */
const EXPLORE_BONUS = 1.5;
/** Finish ratio only counts once a language has this many plays; below that it is noise. */
const MIN_PLAYS_FOR_RATIO = 3;
const MIN_ENGAGED_FOR_MIX = 5;

const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);

export function rankTracks(pool: PoolTrack[], signals: StationSignal[], opts: RankOptions = {}): PoolTrack[] {
  const { language = null, wantTags = [], limit = 20, random = Math.random, prior } = opts;
  const byId = new Map(pool.map((t) => [t.id, t]));

  // What the listener's signals say about tags and languages; signals on tracks no longer in the pool still count.
  const tagAffinity = new Map<string, number>();
  const langAffinity = new Map<string, number>();
  const lastHeard = new Map<string, number>();
  const trackAdj = new Map<string, number>();
  for (const s of signals) {
    const t = byId.get(s.trackId);
    if (s.kind !== "skip" || s.ageMs < RECENT_PLAY_MS) {
      lastHeard.set(s.trackId, Math.min(lastHeard.get(s.trackId) ?? Infinity, s.ageMs));
    }
    if (!t) continue;
    const w = WEIGHT[s.kind] * decay(s.ageMs);
    for (const tag of t.tags) tagAffinity.set(tag, (tagAffinity.get(tag) ?? 0) + w);
    langAffinity.set(t.language, (langAffinity.get(t.language) ?? 0) + w);
    if (s.kind === "skip") trackAdj.set(t.id, (trackAdj.get(t.id) ?? 0) - 2 * decay(s.ageMs));
  }

  // Per-language engagement: the share of the listener's plays/finishes that went to each language (the mix), and how
  // often they finish what they start there (smoothed so one early finish does not swing it).
  const plays = new Map<string, number>();
  const finishes = new Map<string, number>();
  const touched = new Set<string>();
  let engaged = 0;
  for (const s of signals) {
    touched.add(s.trackId);
    const t = byId.get(s.trackId);
    if (!t) continue;
    if (s.kind === "play") plays.set(t.language, (plays.get(t.language) ?? 0) + 1);
    if (s.kind === "finish") finishes.set(t.language, (finishes.get(t.language) ?? 0) + 1);
    if (s.kind === "play" || s.kind === "finish") engaged += 1;
  }
  const langScore = (lang: string) => {
    const p = plays.get(lang) ?? 0;
    const f = finishes.get(lang) ?? 0;
    // The mix only means something once there is some history; scale it in so a first play does not dominate.
    const share = engaged > 0 ? ((p + f) / engaged) * Math.min(1, engaged / MIN_ENGAGED_FOR_MIX) : 0;
    const ratio = p >= MIN_PLAYS_FOR_RATIO ? (f + 1) / (p + 2) - 0.5 : 0;
    return 1.5 * share + 2 * ratio;
  };

  let candidates = pool;
  if (language && pool.some((t) => t.language === language)) candidates = pool.filter((t) => t.language === language);

  const want = new Set(wantTags);
  const scored = candidates.map((t) => {
    let score = 0;
    for (const tag of t.tags) {
      if (want.has(tag)) score += 3;
      score += 0.5 * (tagAffinity.get(tag) ?? 0);
    }
    score += 0.5 * (langAffinity.get(t.language) ?? 0);
    score += trackAdj.get(t.id) ?? 0;
    score += langScore(t.language);
    if (prior) score += prior(t);
    if (!touched.has(t.id)) score += EXPLORE_BONUS;
    const heard = lastHeard.get(t.id);
    if (heard !== undefined && heard < RECENT_PLAY_MS) score -= 10 * (1 - heard / RECENT_PLAY_MS);
    return { t, score: score + random() * 0.5 };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.t);
}
