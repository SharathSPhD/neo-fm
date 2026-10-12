/** Rules for the public profile bio. Pure so the API route and tests share one source of truth. */

export const BIO_MAX_CHARS = 280;

export type BioResult = { ok: true; bio: string | null } | { ok: false; error: "too_long" | "links_not_allowed" };

// Spam magnets: links, bare domains and email addresses. A bio is a sentence about the creator.
const URL_RE = /(https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN_RE = /\b[a-z0-9-]+\.(com|net|org|io|in|co|me|ly|gg|xyz|app|dev|link)\b/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Normalise and validate a bio. Empty input clears it (bio: null). Length counts user-perceived
 * characters via code points so Indic scripts are not penalised by UTF-16 length.
 */
export function normalizeBio(raw: string): BioResult {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex -- strip control chars except newline
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned === "") return { ok: true, bio: null };
  if (Array.from(cleaned).length > BIO_MAX_CHARS) return { ok: false, error: "too_long" };
  if (URL_RE.test(cleaned) || BARE_DOMAIN_RE.test(cleaned) || EMAIL_RE.test(cleaned)) {
    return { ok: false, error: "links_not_allowed" };
  }
  return { ok: true, bio: cleaned };
}
