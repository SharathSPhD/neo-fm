/**
 * Station programming: a clock wheel over the ranked pool. Ranking decides who is liked; this layer decides what plays
 * *now*: a mood for the listener-local hour (daypart), a slot pattern (opener, familiar, exploration, occasion, repeat)
 * and an energy arc. Tags are optional on pool rows, so every rule falls back to rank order when a track has none.
 */
import type { PoolTrack, StationSignal } from "./rank";
import { clashes, transitionCost } from "./flow";
import { allowed, RELAXATION, type RotationState } from "./rotation";

export type Daypart = "dawn" | "morning" | "midday" | "evening" | "dusk" | "night";
export type Slot = "opener" | "familiar" | "exploration" | "occasion" | "repeat";

/** Listener-local hour (0-23) to daypart. */
export function daypartOf(hour: number): Daypart {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 16) return "midday";
  if (hour >= 16 && hour < 19) return "evening";
  if (hour >= 19 && hour < 21) return "dusk";
  return "night";
}

/** Tag weights per daypart; unknown tags score 0, so a pool with sparse tags simply keeps its rank order. */
const PROFILE: Record<Daypart, Record<string, number>> = {
  dawn: { devotional: 3, bhakti: 2, calm: 2, classical: 2, "light-classical": 2, slow: 1, energetic: -2, fast: -2 },
  morning: { energetic: 3, joyful: 2, playful: 2, pop: 2, fast: 2, medium: 1, melancholic: -2, slow: -1 },
  midday: { calm: 2, medium: 2, "light-classical": 1, folk: 1, ballad: 1, energetic: -1 },
  evening: { nostalgic: 3, romantic: 2, ballad: 2, melancholic: 1, medium: 1, folk: 1 },
  dusk: { devotional: 3, bhakti: 2, "light-classical": 2, classical: 1, calm: 1 },
  night: { calm: 3, romantic: 2, slow: 2, melancholic: 1, ballad: 1, energetic: -3, fast: -2 },
};

/** At peak hours two slow tracks in a row feel like dead air. */
const PEAK: ReadonlySet<Daypart> = new Set(["morning", "midday", "evening"]);

/** Sized below the rank bonus (max 2) plus a daypart match, so a strong fit still beats rotation. */
const VOICE_RUN_PENALTY = 1.5;

/** Per unit of transition cost (lib/station/flow.ts): a devotional-to-dance clash (10) outweighs any daypart fit, a one-step energy change (1) barely registers. */
const TRANSITION_WEIGHT = 0.7;

/** 30 s clips (lyria-3-clip) are short features: at most this share of recent airtime, never back to back, so a language does not sound stuttery. */
const CLIP_MAX_SECONDS = 45;
const CLIP_AIRTIME_SHARE = 0.15;
const UNKNOWN_SECONDS = 60;
const secondsOf = (t: PoolTrack) => (typeof t.durationSeconds === "number" && t.durationSeconds > 0 ? t.durationSeconds : UNKNOWN_SECONDS);
export const isClip = (t: PoolTrack) => typeof t.durationSeconds === "number" && t.durationSeconds > 0 && t.durationSeconds < CLIP_MAX_SECONDS;

/** Whether `t` may play after `played` (oldest first): any full track; a clip only if the last one was not a clip and clips stay within their airtime share. */
export function clipAllowed(t: PoolTrack, played: readonly PoolTrack[]): boolean {
  if (!isClip(t)) return true;
  if (played.length > 0 && isClip(played[played.length - 1]!)) return false;
  let total = secondsOf(t), clips = secondsOf(t);
  for (const p of played) { total += secondsOf(p); if (isClip(p)) clips += secondsOf(p); }
  return clips / total <= CLIP_AIRTIME_SHARE;
}

const WHEEL: readonly Slot[] = ["opener", "familiar", "familiar", "exploration", "occasion", "repeat"];

/** Fit of a tagger-assigned daypart set: a listed part is a strong match, an unlisted one a mild mismatch. */
const TAGGED_MATCH = 4;
const TAGGED_MISS = -1;

export function daypartFit(track: PoolTrack, part: Daypart): number {
  // Tagger output (migration 0096) wins; rows it has not reached keep the tag-derived profile.
  if (track.daypart && track.daypart.length > 0) return track.daypart.includes(part) ? TAGGED_MATCH : TAGGED_MISS;
  const profile = PROFILE[part];
  let fit = 0;
  for (const tag of track.tags) fit += profile[tag] ?? 0;
  return fit;
}

/** Theme tags the calendar favours on a given date (month 1-12). Soft-launch window: Diwali 2026 is on 8 Nov. */
export function occasionThemes(month: number, day: number): string[] {
  const d = month * 100 + day;
  if (d >= 1018 && d <= 1112) return ["diwali", "festive", "celebratory"];
  return [];
}

/** Tracks the listener has shown they know and like: finished, liked, replayed or shared. */
export function familiarIds(signals: StationSignal[]): Set<string> {
  const out = new Set<string>();
  for (const s of signals) if (s.kind === "finish" || s.kind === "like" || s.kind === "replay" || s.kind === "share") out.add(s.trackId);
  return out;
}

export interface ProgramContext {
  /** Listener-local hour 0-23. */
  hour: number;
  month: number;
  day: number;
  familiar: ReadonlySet<string>;
  /** Where in the wheel the queue starts; lets a refill carry on from the previous one. */
  startSlot?: number;
  limit?: number;
  /** Rotation rules (lib/station/rotation.ts); omit for none. */
  rotation?: RotationState;
  /** Occasion themes to favour regardless of the calendar (named stations, e.g. Diwali Radio). */
  themes?: readonly string[];
}

function pickPool(preferred: PoolTrack[], all: PoolTrack[], state: RotationState, out: PoolTrack[]): PoolTrack[] {
  for (const rules of RELAXATION) {
    const a = preferred.filter((t) => allowed(t, state, out, rules));
    if (a.length > 0) return a;
    const b = all.filter((t) => allowed(t, state, out, rules));
    if (b.length > 0) return b;
  }
  return all;
}

/** Tagger energy when present, else the "slow" tempo tag. */
const isSlow = (t: PoolTrack) => (t.energy ? t.energy === "low" : t.tags.includes("slow"));

/** `ranked` is best-first from rankTracks; its order is the tie-breaker for everything here. */
export function programQueue(ranked: PoolTrack[], ctx: ProgramContext): PoolTrack[] {
  const part = daypartOf(ctx.hour);
  const themes = new Set(ctx.themes ?? occasionThemes(ctx.month, ctx.day));
  const n = ranked.length;
  const rankBonus = new Map(ranked.map((t, i) => [t.id, n > 1 ? 2 * (1 - i / (n - 1)) : 2]));
  // Voice rotation (migration 0104 tags): after two same-gender leads in a row, nudge the next pick toward another voice.
  // A nudge, not a rule: untagged tracks and a one-voice pool are unaffected, and rank/daypart can still win.
  const voiceRun = (out: PoolTrack[]) => {
    const a = out[out.length - 1]?.voice, b = out[out.length - 2]?.voice;
    return a && a === b && a !== "mixed" ? a : null;
  };
  const lastPlayed = () => out[out.length - 1] ?? ctx.rotation?.history[ctx.rotation.history.length - 1];
  const score = (t: PoolTrack) =>
    daypartFit(t, part) + (rankBonus.get(t.id) ?? 0) - (t.voice && t.voice === voiceRun(out) ? VOICE_RUN_PENALTY : 0) - TRANSITION_WEIGHT * transitionCost(lastPlayed(), t);

  const remaining = [...ranked];
  const out: PoolTrack[] = [];
  const rotation: RotationState = ctx.rotation ?? { history: [], recentIds: new Set(), languageLocked: true };
  const limit = Math.min(ctx.limit ?? 10, n);

  while (out.length < limit && remaining.length > 0) {
    const slot = WHEEL[((ctx.startSlot ?? 0) + out.length) % WHEEL.length]!;
    const prev = out[out.length - 1];
    // Energy arc: at peak hours, after a slow track prefer anything that is not slow (if anything is left).
    // Clips come first: they are filtered out (when anything else is left) before any other rule runs.
    const played = [...(ctx.rotation?.history ?? []), ...out];
    const fullOnly = remaining.filter((t) => clipAllowed(t, played));
    const eligible = fullOnly.length > 0 ? fullOnly : remaining;
    const arcOk = PEAK.has(part) && prev && isSlow(prev) ? eligible.filter((t) => !isSlow(t)) : eligible;
    const arcPool = arcOk.length > 0 ? arcOk : eligible;
    // Flow: drop candidates that clash with the previous track (devotional into dance, low energy into high) while any other exists.
    const before = lastPlayed();
    const smooth = arcPool.filter((t) => !clashes(before, t));
    const flowPool = smooth.length > 0 ? smooth : arcPool;
    // Rotation is stricter than the arc: relax the arc first, then the rotation rules one by one, never the dedupe.
    const pool = pickPool(flowPool, eligible, rotation, out);

    let pick: PoolTrack[];
    if (slot === "familiar" || slot === "repeat") pick = pool.filter((t) => ctx.familiar.has(t.id));
    else if (slot === "exploration") pick = pool.filter((t) => !ctx.familiar.has(t.id));
    else if (slot === "occasion") pick = pool.filter((t) => t.tags.some((g) => themes.has(g)));
    else pick = pool;
    if (pick.length === 0) pick = pool;

    const best = pick.reduce((a, b) => (score(b) > score(a) ? b : a));
    out.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return out;
}
