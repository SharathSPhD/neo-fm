import type { SupabaseClient } from "@supabase/supabase-js";

import { hasPersonalizationConsent } from "../personalization/load";
import { JUDGE_WEIGHT, LISTENER_WEIGHT, songReward } from "./reward";
import type { PolicyRow, StatRow } from "./policy";

/** Every read degrades to "nothing": a missing table (migration 0114 not applied) or a DB error means the env flags decide. */
export async function loadPolicyRows(db: SupabaseClient): Promise<PolicyRow[]> {
  const { data, error } = await db.from("harness_policy").select("language,tier,arm_id,role,max_share");
  if (error || !data) return [];
  return (data as PolicyRow[]).map((r) => ({ ...r, max_share: Number(r.max_share) }));
}

export async function loadStats(db: SupabaseClient, language: string, tier: string, userId: string | null): Promise<{ global: StatRow[]; user: StatRow[] }> {
  const { data, error } = await db.from("harness_arm_stats").select("user_id,arm_id,a,b,tier").eq("language", language).in("tier", [tier, "*"]);
  if (error || !data) return { global: [], user: [] };
  const rows = data as { user_id: string | null; arm_id: string; a: number; b: number }[];
  const toStat = (r: { arm_id: string; a: number; b: number }): StatRow => ({ arm_id: r.arm_id, a: Number(r.a), b: Number(r.b) });
  return { global: rows.filter((r) => !r.user_id).map(toStat), user: userId ? rows.filter((r) => r.user_id === userId).map(toStat) : [] };
}

export async function recordChoice(db: SupabaseClient, c: { job_id: string; user_id: string; language: string; tier: string; arm_id: string; source: "policy" | "flags" }): Promise<void> {
  await db.from("harness_arm_choices").upsert(c, { onConflict: "job_id", ignoreDuplicates: true });
}

/** Add `wins`/`losses` to one posterior, creating the row on first use. Low volume, so read-then-write is fine. */
export async function bump(db: SupabaseClient, scope: { user_id: string | null; language: string; tier: string; arm_id: string }, wins: number, losses: number): Promise<void> {
  let q = db.from("harness_arm_stats").select("id,a,b").eq("language", scope.language).eq("tier", scope.tier).eq("arm_id", scope.arm_id);
  q = scope.user_id ? q.eq("user_id", scope.user_id) : q.is("user_id", null);
  const { data } = await q.limit(1);
  const row = (data ?? [])[0] as { id: number; a: number; b: number } | undefined;
  if (row) await db.from("harness_arm_stats").update({ a: Number(row.a) + wins, b: Number(row.b) + losses, updated_at: new Date().toISOString() }).eq("id", row.id);
  else await db.from("harness_arm_stats").insert({ ...scope, a: 1 + wins, b: 1 + losses });
}

/** A judged battle (for example the Haiku proxy judge) between this arm and the champion; ties count half. */
export async function addJudgeResult(db: SupabaseClient, r: { language: string; tier: string; arm_id: string; wins: number; ties: number; losses: number }): Promise<void> {
  const w = (r.wins + 0.5 * r.ties) * JUDGE_WEIGHT;
  const l = (r.losses + 0.5 * r.ties) * JUDGE_WEIGHT;
  await bump(db, { user_id: null, language: r.language, tier: r.tier, arm_id: r.arm_id }, w, l);
}

const MIN_AGE_MS = 24 * 3600_000;
const GIVE_UP_MS = 14 * 24 * 3600_000;

export interface SettleResult { looked: number; settled: number; noSignal: number }

/**
 * Turns listener events on finished songs into posterior updates. A choice is settled once (settled_at), so reruns never double count.
 * Songs with no signal stay open for up to 14 days, then close without moving anything. Per-user posteriors need the 'personalize' consent.
 */
export async function settleChoices(db: SupabaseClient, opts: { limit?: number; now?: number; minAgeMs?: number } = {}): Promise<SettleResult> {
  const now = opts.now ?? Date.now();
  const before = new Date(now - (opts.minAgeMs ?? MIN_AGE_MS)).toISOString();
  const { data } = await db.from("harness_arm_choices").select("job_id,user_id,language,tier,arm_id,created_at").is("settled_at", null).lt("created_at", before).order("created_at").limit(opts.limit ?? 200);
  const open = (data ?? []) as { job_id: string; user_id: string | null; language: string; tier: string; arm_id: string; created_at: string }[];
  const out: SettleResult = { looked: open.length, settled: 0, noSignal: 0 };
  if (!open.length) return out;
  const { data: ev } = await db.from("feedback_events").select("job_id,kind,value").in("job_id", open.map((c) => c.job_id));
  const byJob = new Map<string, { kind: string; value: number | null }[]>();
  for (const e of (ev ?? []) as { job_id: string; kind: string; value: number | null }[]) byJob.set(e.job_id, [...(byJob.get(e.job_id) ?? []), e]);
  const consent = new Map<string, boolean>();
  for (const c of open) {
    const reward = songReward(byJob.get(c.job_id) ?? []);
    const expired = now - new Date(c.created_at).getTime() > GIVE_UP_MS;
    if (reward === null) {
      out.noSignal += 1;
      if (expired) await db.from("harness_arm_choices").update({ settled_at: new Date(now).toISOString() }).eq("job_id", c.job_id);
      continue;
    }
    const wins = reward * LISTENER_WEIGHT;
    const losses = (1 - reward) * LISTENER_WEIGHT;
    await bump(db, { user_id: null, language: c.language, tier: c.tier, arm_id: c.arm_id }, wins, losses);
    if (c.user_id) {
      if (!consent.has(c.user_id)) consent.set(c.user_id, await hasPersonalizationConsent(db, c.user_id).catch(() => false));
      if (consent.get(c.user_id)) await bump(db, { user_id: c.user_id, language: c.language, tier: c.tier, arm_id: c.arm_id }, wins, losses);
    }
    await db.from("harness_arm_choices").update({ settled_at: new Date(now).toISOString(), reward }).eq("job_id", c.job_id);
    out.settled += 1;
  }
  return out;
}
