/**
 * Station ranking v0: tag rules plus the listener's own recent signals. No ML, no embeddings, and no claim of
 * personalisation beyond what is scored here: a track gains for tags and languages the listener liked or
 * finished, loses for ones they skipped, and is pushed down after it was just heard.
 */
export interface PoolTrack {
  id: string;
  language: string;
  tags: string[];
  /** Stand-in for a prompt/artist-style family until pool rows carry one: tracks sharing it should not play close together. */
  family?: string;
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
}

const HALF_LIFE_MS = 14 * 86_400_000;
const WEIGHT: Record<StationSignalKind, number> = { like: 3, share: 2, replay: 2, finish: 1, play: 0, skip: -2 };
const RECENT_PLAY_MS = 6 * 3_600_000;

const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);

export function rankTracks(pool: PoolTrack[], signals: StationSignal[], opts: RankOptions = {}): PoolTrack[] {
  const { language = null, wantTags = [], limit = 20, random = Math.random } = opts;
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
    const heard = lastHeard.get(t.id);
    if (heard !== undefined && heard < RECENT_PLAY_MS) score -= 10 * (1 - heard / RECENT_PLAY_MS);
    return { t, score: score + random() * 0.5 };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.t);
}
