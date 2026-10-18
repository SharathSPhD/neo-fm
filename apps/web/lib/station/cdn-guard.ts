/**
 * Keeps the R2 CDN inside Cloudflare's free tier. Cloudflare has no hard spend cap for R2, so the queue stops handing out CDN
 * URLs (and falls back to Supabase signed URLs) when estimated usage nears the free limits: 10M class B (read) operations a month
 * and 10 GB of storage. Reads cannot be counted at the CDN from here, so station signals in the last 30 days stand in for plays
 * (each play is several ranged GETs). The estimate errs high on purpose; missing data leaves the CDN on.
 */
export const R2_FREE = { classBOps: 10_000_000, storageBytes: 10 * 1024 ** 3 };
const OPS_PER_SIGNAL = 8;
const AVG_TRACK_BYTES = 4 * 1024 ** 2;
const MARGIN = 0.7;

export function cdnWithinBudget(i: { signals30d: number | null; poolTracks: number }): boolean {
  if (i.poolTracks * AVG_TRACK_BYTES > R2_FREE.storageBytes * MARGIN) return false;
  if (i.signals30d !== null && i.signals30d * OPS_PER_SIGNAL > R2_FREE.classBOps * MARGIN) return false;
  return true;
}

interface CountClient {
  from(table: string): { select(cols: string, opts: { count: "exact"; head: true }): { gte(col: string, v: string): PromiseLike<{ count: number | null; error: unknown }> } };
}

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; signals30d: number | null } | null = null;

/** Signals in the last 30 days, cached for ten minutes per instance. Null when the count is unavailable. */
export async function signals30d(admin: CountClient, now = Date.now()): Promise<number | null> {
  if (cached && now - cached.at < TTL_MS) return cached.signals30d;
  let n: number | null = null;
  try {
    const { count, error } = await admin.from("station_signals").select("id", { count: "exact", head: true }).gte("created_at", new Date(now - 30 * 86_400_000).toISOString());
    n = error ? null : count;
  } catch {
    n = null;
  }
  cached = { at: now, signals30d: n };
  return n;
}

export function resetCdnGuardCache(): void {
  cached = null;
}
