import type { SupabaseClient } from "@supabase/supabase-js";

import { hasPersonalizationConsent } from "../personalization/load";
import { pickArm, policyEnabled, seedFor, type Pick, type PolicyArm } from "./policy";
import { JUDGE_WEIGHT, LISTENER_WEIGHT, songReward } from "./reward";
import { bump, loadPolicyRows, loadStats } from "./store";

/**
 * Render-side arms for the same bandit: how the sung text and style line reach the music model. Same table, caps, fallback and
 * Thompson draw as the lyric arms (policy.ts); arm ids start with "r_" so the two decisions never mix. An arm reaches live
 * traffic only after an operator promotes it, and the policy never writes prompt text: the cue and English-style wording live in
 * code (lib/engine/english-styles.ts, CUE_SETS) and were reviewed before they shipped.
 */
export interface RenderArm extends PolicyArm {
  /** mech = native-plus-ITRANS guide (today's default); claude = Claude-written Latin lines (DICTION_CLAUDE_ROMAN) */
  roman: "mech" | "claude";
  /** English only: true adds the routed English style fragment (ENGLISH_STYLES) even with the flag off, false removes it, undefined leaves whatever routing did */
  englishStyle?: boolean;
  /** key into CUE_SETS: an extra style-cue clause for the language */
  cue?: string;
}

const base = { exemplars: 0, playbook: false } as const;
export const RENDER_ARMS: Record<string, RenderArm> = {
  r_mech: { id: "r_mech", ...base, roman: "mech" },
  r_claude: { id: "r_claude", ...base, roman: "claude" },
  r_en_plain: { id: "r_en_plain", ...base, roman: "mech", englishStyle: false },
  r_en_styles: { id: "r_en_styles", ...base, roman: "mech", englishStyle: true },
};

/**
 * Style-cue sets by arm cue key then language. Empty on purpose: E8 showed a mild catalog cue does not move the audio and E9
 * (stronger cue, blind pairwise judge) has not run, so no cue wording has earned a place. A winner is added here, in code review,
 * with an arm that points at it.
 */
export const CUE_SETS: Record<string, Record<string, string>> = {};

/** What the env flags alone do today for the render step; the answer whenever the policy is off, empty or unreadable. */
export function renderFlagArm(env: Record<string, string | undefined>, language: string): RenderArm {
  if (language === "en") return env.ENGLISH_STYLES === "1" ? RENDER_ARMS.r_en_styles! : RENDER_ARMS.r_en_plain!;
  const langs = (env.DICTION_CLAUDE_ROMAN ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return langs.includes(language) ? RENDER_ARMS.r_claude! : RENDER_ARMS.r_mech!;
}

/** Stored Gemini sung-word match (0-100) as a reward. 100 -> 1, the 80 gate -> 0.6, 50 or less -> 0. */
export function dictionReward(matchPct: number): number {
  return Math.min(1, Math.max(0, (matchPct - 50) / 50));
}
/** One Gemini listen is a measurement, not a verdict, so it counts for half a judged battle. */
export const DICTION_WEIGHT = 0.5 * JUDGE_WEIGHT;

export interface ChooseRenderInput {
  env: Record<string, string | undefined>;
  jobId: string;
  userId: string;
  language: string;
  tier: string;
}

export function pickRenderArm(i: Omit<Parameters<typeof pickArm>[0], "registry" | "fallbackArm" | "premiumModel" | "tastePrior">): Pick & { arm: RenderArm } {
  const p = pickArm({ ...i, registry: RENDER_ARMS, fallbackArm: renderFlagArm(i.env, i.language) });
  return { ...p, arm: RENDER_ARMS[p.arm.id]! };
}

/** The render arm for this job. Policy off: exactly the env flags, no database access. Any failure falls back to the flags. */
export async function chooseRenderArm(db: SupabaseClient, i: ChooseRenderInput): Promise<Pick & { arm: RenderArm }> {
  const flags = (reason: string): Pick & { arm: RenderArm } => ({ arm: renderFlagArm(i.env, i.language), source: "flags", reason });
  if (!policyEnabled(i.env)) return flags("HARNESS_POLICY off");
  try {
    const rows = await loadPolicyRows(db);
    const personal = await hasPersonalizationConsent(db, i.userId).catch(() => false);
    const stats = await loadStats(db, i.language, i.tier, personal ? i.userId : null);
    const pick = pickRenderArm({ env: i.env, language: i.language, tier: i.tier, rows, global: stats.global, user: stats.user, seed: seedFor(i.jobId) });
    await db.from("harness_render_choices").upsert({ job_id: i.jobId, user_id: i.userId, language: i.language, tier: i.tier, arm_id: pick.arm.id, source: pick.source }, { onConflict: "job_id", ignoreDuplicates: true });
    return pick;
  } catch {
    return flags("policy unavailable");
  }
}

/** Style line after the arm's English-style and cue choices. Pure; process.ts passes in what routing already added. */
export function applyRenderArm(arm: RenderArm, language: string, stylePrompt: string, englishFragment: string | undefined): string {
  let out = stylePrompt;
  if (language === "en" && englishFragment) {
    if (arm.englishStyle === true && !out.includes(englishFragment)) out = `${out} ${englishFragment}`.trim();
    if (arm.englishStyle === false && out.includes(englishFragment)) out = out.replace(englishFragment, "").replace(/\s{2,}/g, " ").trim();
  }
  const cue = arm.cue ? CUE_SETS[arm.cue]?.[language] : undefined;
  return cue && !out.includes(cue) ? `${out} ${cue}`.trim() : out;
}

const MIN_AGE_MS = 24 * 3600_000;
const GIVE_UP_MS = 14 * 24 * 3600_000;
export interface RenderSettle { looked: number; settled: number; noSignal: number }

/**
 * Settles render choices after the diction QA (agent_runs.diction_qa.matchPct) and listener events have had time to land.
 * Reward = diction (weight 0.5) plus listener events when there are any (weight 0.2), each as its own update to the posterior.
 * One settlement per job; jobs with neither signal stay open up to 14 days.
 */
export async function settleRenderChoices(db: SupabaseClient, opts: { limit?: number; now?: number; minAgeMs?: number } = {}): Promise<RenderSettle> {
  const now = opts.now ?? Date.now();
  const before = new Date(now - (opts.minAgeMs ?? MIN_AGE_MS)).toISOString();
  const { data } = await db.from("harness_render_choices").select("job_id,user_id,language,tier,arm_id,created_at").is("settled_at", null).lt("created_at", before).order("created_at").limit(opts.limit ?? 200);
  const open = (data ?? []) as { job_id: string; user_id: string | null; language: string; tier: string; arm_id: string; created_at: string }[];
  const out: RenderSettle = { looked: open.length, settled: 0, noSignal: 0 };
  if (!open.length) return out;
  const ids = open.map((c) => c.job_id);
  const [{ data: runs }, { data: ev }] = await Promise.all([
    db.from("agent_runs").select("job_id,diction_qa").in("job_id", ids),
    db.from("feedback_events").select("job_id,kind,value").in("job_id", ids),
  ]);
  const diction = new Map<string, number>();
  for (const r of (runs ?? []) as { job_id: string; diction_qa: { matchPct?: number } | null }[]) if (typeof r.diction_qa?.matchPct === "number") diction.set(r.job_id, r.diction_qa.matchPct);
  const byJob = new Map<string, { kind: string; value: number | null }[]>();
  for (const e of (ev ?? []) as { job_id: string; kind: string; value: number | null }[]) byJob.set(e.job_id, [...(byJob.get(e.job_id) ?? []), e]);
  const consent = new Map<string, boolean>();
  for (const c of open) {
    const d = diction.get(c.job_id);
    const listener = songReward(byJob.get(c.job_id) ?? []);
    if (d === undefined && listener === null) {
      out.noSignal += 1;
      if (now - new Date(c.created_at).getTime() > GIVE_UP_MS) await db.from("harness_render_choices").update({ settled_at: new Date(now).toISOString() }).eq("job_id", c.job_id);
      continue;
    }
    const parts: { r: number; w: number }[] = [];
    if (d !== undefined) parts.push({ r: dictionReward(d), w: DICTION_WEIGHT });
    if (listener !== null) parts.push({ r: listener, w: LISTENER_WEIGHT });
    const personal = c.user_id ? (consent.get(c.user_id) ?? (consent.set(c.user_id, await hasPersonalizationConsent(db, c.user_id).catch(() => false)), consent.get(c.user_id))) : false;
    for (const p of parts) {
      await bump(db, { user_id: null, language: c.language, tier: c.tier, arm_id: c.arm_id }, p.r * p.w, (1 - p.r) * p.w);
      if (personal) await bump(db, { user_id: c.user_id, language: c.language, tier: c.tier, arm_id: c.arm_id }, p.r * p.w, (1 - p.r) * p.w);
    }
    const total = parts.reduce((a, p) => a + p.w, 0);
    await db.from("harness_render_choices").update({ settled_at: new Date(now).toISOString(), reward: parts.reduce((a, p) => a + p.r * p.w, 0) / total, diction: d ?? null }).eq("job_id", c.job_id);
    out.settled += 1;
  }
  return out;
}
