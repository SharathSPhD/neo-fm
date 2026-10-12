import { headers } from "next/headers";

/** Origin of the current request (honours the proxy's forwarded headers); for absolute oEmbed links. */
export function requestOrigin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]!.trim()}://${host}`;
}
