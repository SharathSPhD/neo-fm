/**
 * Search indexing for station pool tracks (/t/[id]). Off until QA passes (SEO_POOL_TRACKS=1): while off, /t pages stay
 * noindex and out of the sitemap. When on, a track is indexed when its language is a launch language or is listed in
 * `LANG_REVIEWED` (its copy passed the AI review); other languages stay noindex until they are listed there.
 */
export const LAUNCH_LANGUAGES = ["kn", "hi", "te", "ta", "mr"] as const;

export function poolTracksIndexable(): boolean {
  return process.env.SEO_POOL_TRACKS === "1";
}

export function isReviewedLanguage(lang: string, reviewedRaw: string | undefined | null = process.env.LANG_REVIEWED): boolean {
  return (reviewedRaw ?? "").split(",").some((c) => c.trim() === lang);
}

export function isLaunchLanguage(lang: string): boolean {
  return (LAUNCH_LANGUAGES as readonly string[]).includes(lang);
}

/** True when this track's page may be indexed and listed in the sitemap. */
export function trackIndexable(lang: string): boolean {
  return poolTracksIndexable() && (isLaunchLanguage(lang) || isReviewedLanguage(lang));
}
