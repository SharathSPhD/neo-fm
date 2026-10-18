/**
 * Rotation rules, as on a real station: a track does not come back within 4 hours, a style family does not repeat
 * within 5 tracks, and one language does not run more than 3 in a row unless the listener locked a language.
 * `violations` counts breaks of the same rules in a played sequence, so the repeat rate is measurable.
 */
import type { PoolTrack } from "./rank";

export const TRACK_SEPARATION_MS = 4 * 3_600_000;
export const FAMILY_SEPARATION = 5;
export const MAX_LANGUAGE_RUN = 3;

export interface RotationState {
  /** What was already played, oldest first (only tracks still in the pool). */
  history: PoolTrack[];
  /** Tracks played within TRACK_SEPARATION_MS. */
  recentIds: ReadonlySet<string>;
  languageLocked: boolean;
}

export interface RuleSet {
  separation: boolean;
  family: boolean;
  languageRun: boolean;
}

/** Strictest first. When the pool is too small for all rules, relax in this order: family, then language run, then track separation. */
export const RELAXATION: readonly RuleSet[] = [
  { separation: true, family: true, languageRun: true },
  { separation: true, family: false, languageRun: true },
  { separation: true, family: false, languageRun: false },
  { separation: false, family: false, languageRun: false },
];

export function allowed(track: PoolTrack, state: RotationState, extra: PoolTrack[], rules: RuleSet): boolean {
  const seq = [...state.history, ...extra];
  if (rules.separation && state.recentIds.has(track.id)) return false;
  if (rules.family && track.family && seq.slice(-FAMILY_SEPARATION).some((t) => t.family === track.family)) return false;
  if (rules.languageRun && !state.languageLocked) {
    const tail = seq.slice(-MAX_LANGUAGE_RUN);
    if (tail.length === MAX_LANGUAGE_RUN && tail.every((t) => t.language === track.language)) return false;
  }
  return true;
}

export interface Violations {
  trackRepeats: number;
  familyRepeats: number;
  languageRuns: number;
}

/** Counts rule breaks in a played sequence. Timestamps are ms; `playedAt` and `seq` are aligned and oldest first. */
export function violations(seq: PoolTrack[], playedAt: number[], languageLocked = false): Violations {
  const v: Violations = { trackRepeats: 0, familyRepeats: 0, languageRuns: 0 };
  seq.forEach((t, i) => {
    for (let j = 0; j < i; j++) {
      if (seq[j]!.id === t.id && playedAt[i]! - playedAt[j]! < TRACK_SEPARATION_MS) { v.trackRepeats += 1; break; }
    }
    if (t.family && seq.slice(Math.max(0, i - FAMILY_SEPARATION), i).some((p) => p.family === t.family)) v.familyRepeats += 1;
    if (!languageLocked && i >= MAX_LANGUAGE_RUN && seq.slice(i - MAX_LANGUAGE_RUN, i).every((p) => p.language === t.language)) v.languageRuns += 1;
  });
  return v;
}
