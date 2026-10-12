/**
 * Native-speaker review kit helpers: opaque reviewer tokens, rating validation and aggregation.
 * The aggregate feeds the advisor go/no-go in managed-agents/EVAL-PCE.md (native kappa >= 0.4).
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const REVIEW_LANGUAGES = ["hi", "kn", "ta", "te", "bn"] as const;
export type ReviewLanguage = (typeof REVIEW_LANGUAGES)[number];
export const SONGS_PER_LANGUAGE = 5;

export function isReviewLanguage(l: string): l is ReviewLanguage {
  return (REVIEW_LANGUAGES as readonly string[]).includes(l);
}

export const LANGUAGE_NAMES: Record<ReviewLanguage, string> = {
  hi: "Hindi",
  kn: "Kannada",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isWellFormedToken(t: string): boolean {
  return TOKEN_RE.test(t);
}

/** Tokens are high-entropy random strings, so an unsalted SHA-256 is enough for lookup. */
export function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

const score = z.number().int().min(1).max(5);

export const RatingSchema = z.object({
  item_id: z.string().uuid(),
  lyric_quality: score,
  pronunciation: score,
  prosody: score,
  cultural_fit: score,
  sounds_native: z.boolean(),
  comment: z.string().trim().max(500).optional(),
});
export type Rating = z.infer<typeof RatingSchema>;

export const DIMENSIONS = ["lyric_quality", "pronunciation", "prosody", "cultural_fit"] as const;

export interface RatingRow {
  token_id: string;
  language: string;
  lyric_quality: number;
  pronunciation: number;
  prosody: number;
  cultural_fit: number;
  sounds_native: boolean;
}

export interface LanguageSummary {
  language: string;
  ratings: number;
  reviewers: number;
  mean: Record<(typeof DIMENSIONS)[number], number>;
  soundsNativeShare: number;
}

export function summarize(rows: readonly RatingRow[]): LanguageSummary[] {
  const byLang = new Map<string, RatingRow[]>();
  for (const r of rows) byLang.set(r.language, [...(byLang.get(r.language) ?? []), r]);
  return [...byLang.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, rs]) => {
      const avg = (k: (typeof DIMENSIONS)[number]) => Math.round((rs.reduce((n, r) => n + r[k], 0) / rs.length) * 100) / 100;
      return {
        language,
        ratings: rs.length,
        reviewers: new Set(rs.map((r) => r.token_id)).size,
        mean: { lyric_quality: avg("lyric_quality"), pronunciation: avg("pronunciation"), prosody: avg("prosody"), cultural_fit: avg("cultural_fit") },
        soundsNativeShare: Math.round((rs.filter((r) => r.sounds_native).length / rs.length) * 100) / 100,
      };
    });
}
