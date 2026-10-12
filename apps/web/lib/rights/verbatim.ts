/**
 * Post-generation check: does the lyrics text reproduce a long run of words from a known protected song?
 *
 * References are stored as hashed word-shingles (see data/reference-fingerprints.json and scripts/rights-fingerprint.mjs),
 * never as lyrics, so the repo carries no protected text. A shingle is `n` consecutive normalised words; a hit is a run of
 * consecutive matching shingles whose span reaches `minWords`. Word-level, so it works for every script we support
 * (all use spaces between words); it does not catch paraphrase, only copying.
 */
import { createHash } from "node:crypto";

import { normaliseText } from "./normalise";

export interface Reference { id: string; title: string; n: number; shingles: string[] }
export interface OverlapHit { id: string; title: string; words: number; excerpt: string }
export type OverlapResult = { ok: true } | { ok: false; hits: OverlapHit[] };

export const SHINGLE_WORDS = 6;
export const MIN_OVERLAP_WORDS = 8;

const words = (s: string) => normaliseText(s).split(" ").filter(Boolean);
const hash = (ws: string[]) => createHash("sha256").update(ws.join(" ")).digest("hex").slice(0, 16);

export function shinglesOf(text: string, n = SHINGLE_WORDS): string[] {
  const ws = words(text); const out: string[] = [];
  for (let i = 0; i + n <= ws.length; i++) out.push(hash(ws.slice(i, i + n)));
  return out;
}

export function makeReference(id: string, title: string, lyrics: string, n = SHINGLE_WORDS): Reference {
  return { id, title, n, shingles: [...new Set(shinglesOf(lyrics, n))] };
}

export function checkVerbatimOverlap(lyrics: string, refs: Reference[], minWords = MIN_OVERLAP_WORDS): OverlapResult {
  const ws = words(lyrics); const hits: OverlapHit[] = [];
  for (const ref of refs) {
    const set = new Set(ref.shingles);
    let runStart = -1; let best = { start: 0, words: 0 };
    for (let i = 0; i + ref.n <= ws.length; i++) {
      if (set.has(hash(ws.slice(i, i + ref.n)))) {
        if (runStart < 0) runStart = i;
        const span = i - runStart + ref.n;
        if (span > best.words) best = { start: runStart, words: span };
      } else runStart = -1;
    }
    if (best.words >= minWords) hits.push({ id: ref.id, title: ref.title, words: best.words, excerpt: ws.slice(best.start, best.start + Math.min(best.words, 6)).join(" ") + "…" });
  }
  return hits.length ? { ok: false, hits } : { ok: true };
}
