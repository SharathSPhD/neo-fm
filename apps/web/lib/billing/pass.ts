/**
 * Station pass entitlement (migration 0098_station_passes; test mode only until S sets the live price).
 * The webhook mirrors the subscription into `station_passes` through apply_station_pass_state; `has_station_pass` says
 * whether it is paid up. Everything here treats a missing function or table as "no pass", so the code can ship before the
 * migration is applied and nothing changes for any listener until then.
 *
 * Perks: no ad breaks (lib/station/ads-server.ts) and a monthly allowance of personal tracks, enforced through the
 * per-user Lyria spend envelope the renderer already checks atomically (lib/agent/process.ts).
 */
import type { TierPlan } from "../agent/tiers";
import { estimatedCostGbp } from "../agent/lyria";

type Env = Record<string, string | undefined>;

/** Default personal tracks per month on the pass (about USD 0.46 each, see docs/handoff/cost-per-listener-hour.md). Two, not four: at INR 149 (about GBP 1.08 net) four full renders cost more than the pass earns (strategy/station-pass-and-lake.md). */
export const DEFAULT_PASS_MONTHLY_TRACKS = 2;
const MAX_PASS_MONTHLY_TRACKS = 30;

/** `STATION_PASS_MONTHLY_TRACKS` overrides the default; anything unusable falls back to it. */
export function passMonthlyTracks(env: Env = process.env): number {
  const raw = env.STATION_PASS_MONTHLY_TRACKS?.trim();
  // A blank variable (Vercel keeps empty ones) must not read as 0 and switch the allowance off.
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_PASS_MONTHLY_TRACKS ? n : DEFAULT_PASS_MONTHLY_TRACKS;
}

/** The monthly Lyria envelope (ledger GBP, ~0.25 per full render) that the allowance buys. */
export function passLyriaCapGbp(env: Env = process.env): number {
  return Math.round(passMonthlyTracks(env) * estimatedCostGbp("full", env as NodeJS.ProcessEnv) * 100) / 100;
}

/** A pass raises the envelope; it never lowers a bigger one the tier already has. */
export function withPassCap(plan: TierPlan, hasPass: boolean, env: Env = process.env): TierPlan {
  if (!hasPass) return plan;
  return { ...plan, userLyriaCapGbp: Math.max(plan.userLyriaCapGbp, passLyriaCapGbp(env)) };
}

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** True while the listener's pass is paid up. False for anyone on any error, including the function not existing yet. */
export async function hasStationPass(db: unknown, userId: string): Promise<boolean> {
  try {
    const { data, error } = await (db as Rpc).rpc("has_station_pass", { p_user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** PostgREST / Postgres codes for "that function does not exist" (migration 0098 not applied yet). */
export function isMissingFunction(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "PGRST202" || e?.code === "42883" || /could not find the function|does not exist/i.test(e?.message ?? "");
}

/**
 * The listener's own Station pass, or null. The pass is its own entitlement (migration 0098), not a tier, so the plan
 * badge never shows it. Read through the owner-select policy (has_station_pass is service-role only); "paid up" is the same
 * predicate as has_station_pass. A missing table reads as no pass.
 */
export async function readOwnStationPass(
  supabase: { from: unknown },
  userId: string,
): Promise<{ currentPeriodEnd: string; cancelAtPeriodEnd: boolean } | null> {
  try {
    const { data } = await (
      (supabase as { from: unknown }).from as unknown as (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{
              data: { status: string; current_period_end: string; cancel_at_period_end: boolean } | null;
            }>;
          };
        };
      }
    )("station_passes")
      .select("status, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data || !["active", "trialing", "past_due"].includes(data.status)) return null;
    if (new Date(data.current_period_end).getTime() <= Date.now()) return null;
    return { currentPeriodEnd: data.current_period_end, cancelAtPeriodEnd: data.cancel_at_period_end };
  } catch {
    return null;
  }
}
