/**
 * Replays the queue route's pipeline (rank, clock wheel, sets) against the pool snapshot, refill after refill, the way a
 * listener's session unfolds. It mirrors app/api/station/queue/route.ts: keep the two in step when the route changes.
 */
import snapshot from "../fixtures/pool-snapshot-2026-10-18.json";
import { TRACK_SEPARATION_MS } from "../../lib/station/rotation";
import { programQueue, familiarIds } from "../../lib/station/program";
import { rankTracks, type PoolTrack, type StationSignal } from "../../lib/station/rank";
import { rowToTrack, type PoolRow } from "../../lib/station/pool";
import { arrangeSets } from "../../lib/station/sets";
import { clashes, energyOf, feelOf, transitionCost } from "../../lib/station/flow";

export const POOL: PoolTrack[] = (snapshot as PoolRow[]).map(rowToTrack);

/** Small deterministic PRNG so a failing session can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SessionOpts {
  hour: number;
  lang: string | null;
  seed: number;
  refills?: number;
  limit?: number;
  sets?: boolean;
  pool?: PoolTrack[];
  month?: number;
  day?: number;
}

/** Everything one listener hears in order, ten tracks per refill; `signals` grow as tracks play. */
export function playSession(o: SessionOpts): PoolTrack[] {
  const pool = o.pool ?? POOL;
  const limit = o.limit ?? 10;
  const random = mulberry32(o.seed);
  const played: PoolTrack[] = [];
  const byId = new Map(pool.map((t) => [t.id, t]));
  for (let r = 0; r < (o.refills ?? 6); r++) {
    const signals: StationSignal[] = played.map((t, i) => ({ trackId: t.id, kind: "play", ageMs: (played.length - i) * 90_000 }));
    const slate = rankTracks(pool, signals, { language: o.lang, wantTags: [], limit: Math.max(limit * 4, 40), random });
    const plays = signals.filter((x) => x.kind === "play").sort((a, b) => b.ageMs - a.ageMs);
    const rotation = {
      history: plays.slice(-10).flatMap((x) => byId.get(x.trackId) ?? []),
      recentIds: new Set(plays.filter((x) => x.ageMs < TRACK_SEPARATION_MS).map((x) => x.trackId)),
      languageLocked: !!o.lang,
    };
    const opts = { hour: o.hour, month: o.month ?? 6, day: o.day ?? 1, familiar: familiarIds(signals), rotation };
    const sets = o.sets ?? true;
    const instrumentals = sets ? pool.filter((t) => t.kind === "instrumental") : [];
    const vocalSlate = sets ? slate.filter((t) => t.kind !== "instrumental") : slate;
    const programmed = programQueue(vocalSlate, { ...opts, limit: sets ? Math.min(limit * 3, 60) : limit });
    let queue = programmed.slice(0, limit);
    if (sets) {
      const instrSlate = rankTracks(instrumentals, signals, { language: null, wantTags: [], limit: 20, random });
      queue = arrangeSets(programmed, programQueue(instrSlate, { ...opts, limit: 6 }), { hour: o.hour, limit, recent: played.slice(-10) }).tracks;
    }
    played.push(...queue);
  }
  return played;
}

export interface FlowStats {
  pairs: number;
  /** Devotional straight next to dance, either order. */
  feelClashes: number;
  /** Low energy straight next to high, either order. */
  energyJumps: number;
  clashes: number;
  meanCost: number;
}

export function flowStats(seq: PoolTrack[]): FlowStats {
  const s: FlowStats = { pairs: 0, feelClashes: 0, energyJumps: 0, clashes: 0, meanCost: 0 };
  let cost = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!, b = seq[i]!;
    s.pairs++;
    const fa = feelOf(a), fb = feelOf(b);
    if ((fa === "devotional" && fb === "dance") || (fa === "dance" && fb === "devotional")) s.feelClashes++;
    if (Math.abs(energyOf(a) - energyOf(b)) === 2) s.energyJumps++;
    if (clashes(a, b)) s.clashes++;
    cost += transitionCost(a, b);
  }
  s.meanCost = s.pairs ? cost / s.pairs : 0;
  return s;
}

export function sumStats(all: FlowStats[]): FlowStats {
  const t: FlowStats = { pairs: 0, feelClashes: 0, energyJumps: 0, clashes: 0, meanCost: 0 };
  let cost = 0;
  for (const s of all) {
    t.pairs += s.pairs; t.feelClashes += s.feelClashes; t.energyJumps += s.energyJumps; t.clashes += s.clashes;
    cost += s.meanCost * s.pairs;
  }
  t.meanCost = t.pairs ? cost / t.pairs : 0;
  return t;
}

export const LANGS: (string | null)[] = [null, "hi", "ta", "te", "kn", "bn", "gu", "mr", "pa", "ml"];
export const HOURS = [0, 3, 6, 7, 9, 11, 13, 15, 17, 18, 20, 22];
