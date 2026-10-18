/**
 * Data-saver decision for audio playback.
 *
 * `auto` follows the browser's own signals (Save-Data header/setting or a
 * 2G-class connection); `on`/`off` are the user's explicit override and
 * always win. Pure so it can be unit-tested without a browser.
 */
export type DataSaverPref = "auto" | "on" | "off";

export interface ConnectionHints {
  saveData?: boolean;
  effectiveType?: string;
}

const SLOW_TYPES = new Set(["slow-2g", "2g"]);

export function isDataSaverActive(
  pref: DataSaverPref,
  hints: ConnectionHints,
): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return Boolean(hints.saveData) || SLOW_TYPES.has(hints.effectiveType ?? "");
}

export function readConnectionHints(): ConnectionHints {
  if (typeof navigator === "undefined") return {};
  const c = (navigator as unknown as { connection?: ConnectionHints }).connection;
  return { saveData: c?.saveData, effectiveType: c?.effectiveType };
}

export function parsePref(v: string | null): DataSaverPref {
  return v === "on" || v === "off" ? v : "auto";
}
