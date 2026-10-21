import type { SupabaseClient } from "@supabase/supabase-js";

import { hasPersonalizationConsent } from "../personalization/load";
import type { TasteBrief } from "../taste/brief";
import { flagArm, pickArm, policyEnabled, seedFor, type Pick } from "./policy";
import { tasteArmPrior } from "./taste";
import { loadPolicyRows, loadStats, recordChoice } from "./store";

export interface ChooseInput {
  env: Record<string, string | undefined>;
  jobId: string;
  userId: string;
  /** language code (kn, hi, ...) */
  language: string;
  tier: string;
  /** model the PCE_PREMIUM_POLISH flag would pick; the flag stays the fallback */
  premiumModel: string | undefined;
  /** the listener's saved taste profile, when TASTE_BRIEF is on; only a cold-start nudge */
  taste?: TasteBrief | null;
}

/**
 * The arm for this job's polish step. With HARNESS_POLICY off this is exactly what the env flags did before, with no database
 * access. With it on, any failure (missing table, DB error) falls back to the flags, so the policy can never block a song.
 */
export async function chooseHarnessArm(db: SupabaseClient, i: ChooseInput): Promise<Pick> {
  if (!policyEnabled(i.env)) return { arm: flagArm(i.env, i.language, i.premiumModel), source: "flags", reason: "HARNESS_POLICY off" };
  try {
    const rows = await loadPolicyRows(db);
    const personal = await hasPersonalizationConsent(db, i.userId).catch(() => false);
    const stats = await loadStats(db, i.language, i.tier, personal ? i.userId : null);
    const pick = pickArm({ env: i.env, language: i.language, tier: i.tier, rows, global: stats.global, user: stats.user, premiumModel: i.premiumModel, tastePrior: personal ? tasteArmPrior(i.taste) : undefined, seed: seedFor(i.jobId) });
    await recordChoice(db, { job_id: i.jobId, user_id: i.userId, language: i.language, tier: i.tier, arm_id: pick.arm.id, source: pick.source });
    return pick;
  } catch {
    return { arm: flagArm(i.env, i.language, i.premiumModel), source: "flags", reason: "policy unavailable" };
  }
}
