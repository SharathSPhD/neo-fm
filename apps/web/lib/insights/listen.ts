/** Helpers for anonymous listener events. Nothing here identifies a listener: only the primary language subtag is kept. */

/** "hi-IN,hi;q=0.9,en;q=0.8" -> "hi". Null for anything that is not a plain 2 to 3 letter language code. */
export function primaryLanguage(acceptLanguage: string | null | undefined): string | null {
  const first = (acceptLanguage ?? "").split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
  const primary = first.split("-")[0] ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/** Do Not Track or Global Privacy Control: either header set to "1" means do not record anything. */
export function optedOutOfTracking(headers: { get(name: string): string | null }): boolean {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1";
}

export const LISTEN_KINDS = ["play", "share"] as const;
export type ListenKind = (typeof LISTEN_KINDS)[number];

export function languageLabel(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
