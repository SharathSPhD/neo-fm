/**
 * "Dedicate this hour": a station link that carries a first name (`for`), so the friend who opens it lands on the
 * sender's station with a banner "This hour is for <name>". Stateless like listen-together: nothing is stored, the
 * name lives only in the link. Because the name is untrusted text from a URL, it is cut down to letters, spaces,
 * apostrophes and hyphens and a short length, which leaves no room for links, numbers or markup.
 * Off unless STATION_DEDICATE=1.
 */
import { findStation } from "./named";

export const DEDICATEE_MAX = 24;

export const dedicateEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STATION_DEDICATE === "1";

/** A name safe to show, or null when nothing usable is left. */
export function cleanDedicatee(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\s'’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DEDICATEE_MAX)
    .trim();
  return /\p{L}/u.test(name) ? name : null;
}

/** `/station` link for a named station (or the sender's own mix when none) dedicated to `name`; null for an unusable name. */
export function dedicateHourUrl(stationSlug: string | null | undefined, rawName: string, origin = "https://neo-fm.com"): string | null {
  const name = cleanDedicatee(rawName);
  if (!name) return null;
  const u = new URL("/station", origin);
  const slug = findStation(stationSlug)?.slug;
  if (slug) u.searchParams.set("s", slug);
  u.searchParams.set("for", name);
  return u.toString();
}
