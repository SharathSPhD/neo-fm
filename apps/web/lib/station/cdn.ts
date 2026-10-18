/**
 * Shared station-pool audio can be served from a public CDN origin (Cloudflare R2) instead of per-listener Supabase signed
 * URLs. Pool tracks are identical for every listener, so the CDN caches them and Supabase egress stops scaling with
 * listeners. Off unless POOL_CDN_BASE is set; any miss falls back to the signed URL, so flag-off behaviour is unchanged.
 */
export function poolCdnUrl(audioPath: string, base = process.env.POOL_CDN_BASE): string | null {
  const root = base?.trim().replace(/\/+$/, "");
  if (!root || !/^https:\/\//.test(root)) return null;
  const key = audioPath.replace(/^tracks\//, "").replace(/^\/+/, "");
  if (!key || key.includes("..")) return null;
  return `${root}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
