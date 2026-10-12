import { LanguageSchema, StyleFamilySchema } from "@neo-fm/song-doc";

/**
 * "More like this" ranking for a song page: content similarity first
 * (same style, same language), with the listener's own taste weights as a
 * gentle tiebreaker when they have opted in. Pure so it is easy to test.
 */
import type { TasteProfile } from "./taste";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

export interface SimilarCandidate {
  public_id: string;
  title: string | null;
  language: string;
  style: string;
}

export interface SimilarPick extends SimilarCandidate {
  reason: string;
}

export function rankSimilar(
  current: { public_id: string; language: string; style: string },
  candidates: SimilarCandidate[],
  profile?: TasteProfile | null,
  limit = 4,
): SimilarPick[] {
  const seen = new Set<string>([current.public_id]);
  const scored: { c: SimilarCandidate; s: number }[] = [];
  for (const c of candidates) {
    if (seen.has(c.public_id)) continue;
    seen.add(c.public_id);
    const sameStyle = c.style === current.style;
    const sameLang = c.language === current.language;
    if (!sameStyle && !sameLang) continue;
    let s = (sameStyle ? 3 : 0) + (sameLang ? 2 : 0);
    if (profile && profile.nSignals >= 3) {
      // Capped so taste reorders near-ties but never beats real similarity.
      const t =
        (profile.weights.language[c.language] ?? 0) +
        (profile.weights.style[c.style] ?? 0);
      s += Math.max(-1, Math.min(1, t * 0.25));
    }
    scored.push({ c, s });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ c }) => ({
      ...c,
      reason:
        c.style === current.style && c.language === current.language
          ? `Same style and language`
          : c.style === current.style
            ? `Also ${prettyStyle(c.style)}`
            : `Also in ${prettyLanguage(c.language)}`,
    }));
}

/** Why a "For you" pick was chosen, from the strongest positive weight. */
export function forYouReason(
  profile: TasteProfile,
  language: string,
  style: string,
): string {
  const l = profile.weights.language[language] ?? 0;
  const s = profile.weights.style[style] ?? 0;
  if (l <= 0.5 && s <= 0.5) return "";
  return s >= l
    ? `Because you like ${prettyStyle(style)}`
    : `Because you like ${prettyLanguage(language)}`;
}

/**
 * PostgREST `or()` clause matching songs with the same style or language.
 * Both columns are Postgres enums, so an unknown value (a stale or odd
 * document) would make the whole request fail with 22P02 rather than match
 * nothing; values are therefore checked against the real enums and unknown
 * ones are dropped. Returns null when neither is usable.
 */
export function similarOrFilter(style: string, language: string): string | null {
  const parts: string[] = [];
  const s = StyleFamilySchema.safeParse(style);
  if (s.success) parts.push(`style_family.eq.${s.data}`);
  const l = LanguageSchema.safeParse(language);
  if (l.success) parts.push(`language.eq.${l.data}`);
  return parts.length > 0 ? parts.join(",") : null;
}
