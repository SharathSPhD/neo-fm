/** Post-sign-in destination: same-origin paths only, so `?next=` can never send a listener to another site. */
export function safeNext(raw: string | null | undefined, fallback = "/library"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  // "//host" and "/\host" are read by browsers as scheme-relative URLs; control characters are never a real path.
  if (raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}
