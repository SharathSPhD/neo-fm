/**
 * Shared tag-merge utility for every co-composer (western, carnatic,
 * hindustani, kannada-folk).
 *
 * A co-composer appends synthesis hints (style:, tempo:, raga:, tala:, ...)
 * to each section's `tags` bag. Producers (the API caller, the lyrics
 * library, a future Pratyabhijna step) can pre-populate tags too. The
 * rule of thumb -- formalised here -- is:
 *
 *   - Producer tags win for any "single-valued" family (key:, style:,
 *     raga:, tala:, tempo:, ...). The composer must NOT add a competing
 *     `raga:Yaman` when the producer already said `raga:Bhairavi`.
 *   - Producer free-form tags (`mood:bright`, `crowd:wedding`) pass
 *     through untouched and the composer's own free-form tags are
 *     appended after them.
 *   - Exact duplicates are coalesced (producer wins position).
 *
 * Without this contract, HeartMuLa would condition on contradictory
 * information (TRIZ C8 -- "do not silently invent musical material").
 */

/** Tag prefixes whose family is single-valued -- only one wins. */
export const SINGLE_VALUED_PREFIXES = [
  "section:",
  "key:",
  "style:",
  "tempo:",
  "time_sig:",
  "lead_vocal:",
  "texture:",
  "progression:",
  // Indian additions (Phase 6):
  "raga:",
  "tala:",
  "aroha:",
  "avaroha:",
  "pakad:",
  "function:",
  "genre:",
] as const;

export function isComposerTagSuperseded(
  composerTag: string,
  producerTags: ReadonlySet<string>,
): boolean {
  for (const prefix of SINGLE_VALUED_PREFIXES) {
    if (composerTag.startsWith(prefix)) {
      for (const p of producerTags) {
        if (p.startsWith(prefix)) return true;
      }
      return false;
    }
  }
  return false;
}

/**
 * Merge producer-supplied tags (which win for single-valued families)
 * with composer-supplied tags. Returns a new array; never mutates input.
 *
 * - Order: producer tags first (preserved), then composer tags whose
 *   single-valued family wasn't already occupied.
 * - Exact duplicates dropped (producer position wins).
 */
export function mergeTags(
  producerTags: readonly string[] | undefined,
  composerTags: readonly string[],
): string[] {
  const producerSet = new Set(producerTags ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of producerTags ?? []) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  for (const t of composerTags) {
    if (seen.has(t)) continue;
    if (isComposerTagSuperseded(t, producerSet)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
