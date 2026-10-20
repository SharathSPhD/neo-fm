import "server-only";

import { serviceClient } from "../agent/adapters";

export interface ReferralSummary {
  /** Public @handle of the sharer this listener joined from, when they have one. */
  joinedFrom: string | null;
  /** How many listeners joined from this listener's shared links. */
  joined: number;
}

const NONE: ReferralSummary = { joinedFrom: null, joined: 0 };

/** Recognition summary for the account page. Service-role read of referrals (migration 0111); any failure, including the table not being applied, yields nothing. */
export async function loadReferralSummary(userId: string): Promise<ReferralSummary> {
  try {
    const db = serviceClient() as unknown as {
      from: (t: string) => {
        select: (c: string, o?: { count: "exact"; head: true }) => {
          eq: (k: string, v: string) => Promise<{ count?: number | null; data?: { referrer_id: string }[] | null; error: unknown }> & {
            maybeSingle: () => Promise<{ data: { referrer_id: string } | null; error: unknown }>;
          };
        };
      };
    };
    const [count, mine] = await Promise.all([
      db.from("referrals").select("referee_id", { count: "exact", head: true }).eq("referrer_id", userId),
      db.from("referrals").select("referrer_id").eq("referee_id", userId).maybeSingle(),
    ]);
    if (count.error && mine.error) return NONE;
    let joinedFrom: string | null = null;
    if (mine.data?.referrer_id) {
      const { data } = await (
        db.from("public_profiles") as unknown as {
          select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { handle: string | null } | null }> } };
        }
      )
        .select("handle")
        .eq("id", mine.data.referrer_id)
        .maybeSingle();
      joinedFrom = data?.handle ?? null;
    }
    return { joinedFrom, joined: count.error ? 0 : (count.count ?? 0) };
  } catch {
    return NONE;
  }
}
