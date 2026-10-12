/**
 * Post-render diction gate: turns the transcript-vs-lyrics score into a verdict.
 *
 *   pass      the song was sung as written (or close enough)
 *   review    something is off (lines garbled or never sung); a human or a re-render should look
 *   rerender  most of the song does not match what was written; do not present it as finished
 *
 * The verdict uses the ORDER-FREE score: Lyria sometimes sings sections in a different order, which is a structure
 * deviation, not a diction failure (it is reported as `reordered`, not gated). Thresholds were tuned on the 65
 * scored renders in managed-agents/quality (see managed-agents/DICTION-GATE.md); they are a starting point for a
 * shadow run, not a measured error rate.
 */
import { scoreTranscript, scoreTranscriptUnordered, type DictionScore } from "./index";

export type DictionVerdict = "pass" | "review" | "rerender";

export interface GateThresholds {
  /** Below this order-free matchPct the song is a failure (same line as the quality report's "failure"). */
  rerenderBelow: number;
  /** Below this it is flagged for review. */
  reviewBelow: number;
  /** This many closing lines never sung => review (a clip that ran out of time). */
  tailLines: number;
  /** Ordered score this far below the order-free one => `reordered` (informational). */
  reorderGap: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = { rerenderBelow: 60, reviewBelow: 80, tailLines: 2, reorderGap: 20 };

export interface GateResult {
  verdict: DictionVerdict;
  matchPct: number;
  unorderedPct: number;
  reasons: string[];
  reordered: boolean;
  tailUnsung: number;
}

/** How many of the final lines were not heard at all (contiguous from the end, CER above `cerCutoff`). */
export function tailUnsung(score: DictionScore, cerCutoff = 0.6): number {
  let n = 0;
  for (let i = score.lines.length - 1; i >= 0 && score.lines[i]!.cer > cerCutoff; i--) n++;
  return n;
}

export function dictionVerdict(ordered: DictionScore, unordered: DictionScore, t: GateThresholds = DEFAULT_THRESHOLDS): GateResult {
  const u = unordered.matchPct;
  const tail = tailUnsung(unordered);
  const reasons: string[] = [];
  let verdict: DictionVerdict = "pass";
  if (u < t.rerenderBelow) { verdict = "rerender"; reasons.push(`order-free match ${u}% is below ${t.rerenderBelow}%`); }
  else if (u < t.reviewBelow) { verdict = "review"; reasons.push(`order-free match ${u}% is below ${t.reviewBelow}%`); }
  if (tail >= t.tailLines) {
    if (verdict === "pass") verdict = "review";
    reasons.push(`last ${tail} lines were not heard`);
  }
  const reordered = unordered.matchPct - ordered.matchPct >= t.reorderGap;
  return { verdict, matchPct: ordered.matchPct, unorderedPct: u, reasons, reordered, tailUnsung: tail };
}

/** Score `lyrics` against `transcript` both ways and gate it. */
export function gateTranscript(lyrics: string, transcript: string, t: GateThresholds = DEFAULT_THRESHOLDS): GateResult {
  return dictionVerdict(scoreTranscript(lyrics, transcript), scoreTranscriptUnordered(lyrics, transcript), t);
}

/** DICTION_GATE=off|shadow. Shadow (default) records the verdict and changes nothing the user sees. */
export function gateMode(env: NodeJS.ProcessEnv = process.env): "off" | "shadow" {
  return env.DICTION_GATE === "off" ? "off" : "shadow";
}
