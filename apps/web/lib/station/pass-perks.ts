import { hasStationPass } from "../billing/pass";

type Db = { from: (t: string) => unknown; rpc: unknown };

/**
 * True when the listener holds the Station pass or a paid tier: Creator and Pro include every pass perk, so they never
 * see a cheaper product with more on it. Any lookup error reads as false (the listener keeps the free station).
 */
export async function hasPassPerks(db: unknown, userId: string): Promise<boolean> {
  try {
    if (await hasStationPass(db, userId)) return true;
    const { data } = await ((db as Db).from("users") as { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { tier?: string } | null }> } } })
      .select("tier").eq("id", userId).maybeSingle();
    return data?.tier === "creator" || data?.tier === "pro" || data?.tier === "developer";
  } catch {
    return false;
  }
}
