/**
 * "Listen together": a shared track link that carries where the sender was in the song (`at`, seconds) and when
 * they sent it (`ts`, epoch ms). A friend who opens it within a short window can join at the same point, so two
 * people hear the same moment without any live infrastructure. Pure and stateless; the receiving page seeks.
 */
import { trackShareUrl } from "./share";

/** A link older than this is just a track link: the sender has moved on. */
export const TOGETHER_MAX_AGE_MS = 30 * 60_000;
/** Tolerated clock difference between the two phones. */
const CLOCK_SKEW_MS = 60_000;
/** Joining this close to the end is pointless; fall back to the plain track. */
const END_GUARD_SECONDS = 3;

export function togetherUrl(id: string, atSeconds: number, nowMs: number, origin?: string): string {
  const u = new URL(trackShareUrl(id, origin));
  u.searchParams.set("at", String(Math.max(0, Math.floor(atSeconds))));
  u.searchParams.set("ts", String(Math.floor(nowMs)));
  return u.toString();
}

/** Seconds to start from for a fresh together link, or null when the link has no live moment (or it is over). */
export function togetherOffset(search: string, nowMs: number, durationSeconds?: number | null): number | null {
  const params = new URLSearchParams(search);
  const atRaw = params.get("at");
  const tsRaw = params.get("ts");
  if (atRaw === null || tsRaw === null || !/^\d{1,5}$/.test(atRaw) || !/^\d{10,14}$/.test(tsRaw)) return null;
  const at = Number(atRaw);
  const ageMs = nowMs - Number(tsRaw);
  if (ageMs < -CLOCK_SKEW_MS || ageMs > TOGETHER_MAX_AGE_MS) return null;
  const offset = Math.floor(at + Math.max(0, ageMs) / 1000);
  if (durationSeconds && offset >= durationSeconds - END_GUARD_SECONDS) return null;
  return offset;
}
