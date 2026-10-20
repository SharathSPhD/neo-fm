/**
 * Server-side referral steps. Every function is best effort and silent: a missing migration, a bad code or a database
 * hiccup must never break sign-in or playback.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cleanRef, newRefCode, referralEnabled } from "./code";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const rpc = (db: SupabaseClient) => db as unknown as Rpc;

/** Called after sign-in with the code from the visitor's cookie. Returns the database verdict, or null if skipped. */
export async function claimReferral(db: SupabaseClient, userId: string, rawCode: unknown, env = process.env): Promise<string | null> {
  const code = cleanRef(rawCode);
  if (!referralEnabled(env) || !code) return null;
  try {
    const { data, error } = await rpc(db).rpc("claim_referral", { p_receiver: userId, p_code: code });
    return error || typeof data !== "string" ? null : data;
  } catch {
    return null;
  }
}

/** Called when a listener finishes a station track; rewards their referrer once. */
export async function rewardReferrer(db: SupabaseClient, receiverId: string, env = process.env): Promise<string | null> {
  if (!referralEnabled(env)) return null;
  try {
    const { data, error } = await rpc(db).rpc("reward_referral_sender", { p_receiver: receiverId });
    return error || typeof data !== "string" ? null : data;
  } catch {
    return null;
  }
}

type Table = {
  select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { code: string } | null; error: unknown }> } };
  insert: (r: object) => Promise<{ error: { code?: string } | null }>;
};

/** The user's share code, created on first use. Null when referrals are off or unavailable. */
export async function ensureRefCode(db: SupabaseClient, userId: string, env = process.env): Promise<string | null> {
  if (!referralEnabled(env)) return null;
  const table = () => (db as unknown as { from: (t: string) => Table }).from("referral_codes");
  try {
    const existing = await table().select("code").eq("user_id", userId).maybeSingle();
    if (existing.error) return null;
    if (existing.data?.code) return existing.data.code;
    for (let i = 0; i < 3; i++) {
      const code = newRefCode();
      const { error } = await table().insert({ user_id: userId, code });
      if (!error) return code;
      if (error.code === "23505") {
        // Unique violation: either a racing request created this user's code, or the random code collided.
        const again = await table().select("code").eq("user_id", userId).maybeSingle();
        if (again.data?.code) return again.data.code;
        continue;
      }
      return null;
    }
  } catch { /* unavailable */ }
  return null;
}
