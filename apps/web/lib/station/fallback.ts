/**
 * One-shot retry from a static fallback URL when a CDN copy fails to load. Decided from a per-item "already tried" set, not
 * by comparing the element's `src`: the fallback is relative (`/voice/x.mp3`) and the CDN URL ends with the same path, so a
 * suffix check wrongly reads the CDN URL as the fallback and the retry never happens.
 */
export function takeFallback(item: { id: string; fallbackUrl?: string } | null | undefined, tried: Set<string>): string | null {
  if (!item?.fallbackUrl || tried.has(item.id)) return null;
  tried.add(item.id);
  return item.fallbackUrl;
}
