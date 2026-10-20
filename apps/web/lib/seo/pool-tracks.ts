/**
 * Search indexing for station pool tracks (/t/[id]). Off until QA passes (SEO_POOL_TRACKS=1): while off, /t pages stay
 * noindex and out of the sitemap, as they were during the soft launch. When on, only the launch languages are indexed.
 */
export const LAUNCH_LANGUAGES = ["kn", "hi", "te", "ta", "mr"] as const;

export function poolTracksIndexable(): boolean {
  return process.env.SEO_POOL_TRACKS === "1";
}

export function isLaunchLanguage(lang: string): boolean {
  return (LAUNCH_LANGUAGES as readonly string[]).includes(lang);
}

/** True when this track's page may be indexed and listed in the sitemap. */
export function trackIndexable(lang: string): boolean {
  return poolTracksIndexable() && isLaunchLanguage(lang);
}
