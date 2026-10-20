/**
 * Referral via shared songs (migration 0111). A code is 8 lowercase base32 characters, one per user, never a handle or
 * an id. Everything here is behind REFERRAL_ENABLED=1.
 */
import { randomBytes } from "node:crypto";

export const REF_COOKIE = "nfm_ref";
export const REF_COOKIE_MAX_AGE = 30 * 86_400;
export const REF_RE = /^[a-z2-7]{8}$/;

export const referralEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.REFERRAL_ENABLED === "1";

/** A well-formed code or null. Format only; the database decides whether it exists. */
export const cleanRef = (v: unknown): string | null => (typeof v === "string" && REF_RE.test(v) ? v : null);

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function newRefCode(bytes: Uint8Array = randomBytes(8)): string {
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

/** The referral code in a Cookie header, if it is well-formed. */
export function refFromCookieHeader(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === REF_COOKIE) return cleanRef(rest.join("="));
  }
  return null;
}
