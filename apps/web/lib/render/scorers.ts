import { scoreTranscriptUnordered } from "../diction";
import type { Scorer } from "./best-of";

/**
 * Default selection weights, from the 2026-10-20 scorer study (docs/handoff/song-render-harness.md):
 * Gemini-heard diction and a Gemini naturalness listen carry the pick; the open scorers are weak or flat
 * (Arena preference head 61.5% held-out, Audiobox PQ 7.9-8.2 across every language) and only break ties.
 */
export const DEFAULT_WEIGHTS = { diction: 0.55, naturalness: 0.3, quality: 0.1, preference: 0.05 } as const;

/** Order-free sung-word match of a Gemini transcript against the written lyrics; a render sung wrongly enough is vetoed. */
export function dictionScorer<C>(lyrics: string, transcribe: (c: C) => Promise<string>, weight = DEFAULT_WEIGHTS.diction): Scorer<C> {
  return {
    name: "diction",
    weight,
    // Same line as the diction gate's `rerender` verdict (lib/diction/gate.ts).
    vetoAtOrBelow: 59,
    score: async (c) => scoreTranscriptUnordered(lyrics, await transcribe(c)).matchPct,
  };
}
