/**
 * Per-listener lyric-grade blend for the station queue (STATION_GRADES=1; strategy/premium-lyrics-tier.md section 10.2).
 * Free 85/15/0, Creator and Station pass 75/25/0, Pro 60/30/10 (Standard/Premium/Studio). Off unless the flag is set; any read
 * failure gives the Free mix, and a pool with no graded tracks (migration 0116 unapplied) plays exactly as before.
 */
import type { UserTier } from "../agent/tiers";
import { hasStationPass } from "../billing/pass";
import { blendFor, type GradeMix } from "../lyrics/grade";

export const stationGradesEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.STATION_GRADES === "1";

type Db = { from: (t: string) => unknown };

export async function listenerMix(db: unknown, userId: string | null, env: Record<string, string | undefined> = process.env): Promise<GradeMix | undefined> {
  if (!stationGradesEnabled(env)) return undefined;
  if (!userId) return blendFor("free");
  try {
    const { data } = await ((db as Db).from("users") as { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { tier?: string } | null }> } } })
      .select("tier").eq("id", userId).maybeSingle();
    return blendFor((data?.tier as UserTier | undefined) ?? "free", await hasStationPass(db, userId));
  } catch {
    return blendFor("free");
  }
}
