/** Shared read paths for the ops routes and the daily snapshot. Read-only. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildFunnel, type CampaignRow, type FunnelRow, type FunnelSummary } from "./funnel";
import { lyriaBudgetGbp } from "./spend-cap";
import { summarize, type DictionRow, type HealthSummary, type JobRow } from "./health-summary";

const JOB_CAP = 2000;
const COHORT_CAP = 2000;

export class OpsQueryError extends Error {}

export async function loadHealthSummary(db: SupabaseClient, hours: number, env = process.env): Promise<HealthSummary & { truncated: boolean }> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [jobs, active, diction, ledger, users] = await Promise.all([
    db.from("jobs").select("status,error,created_at,started_at,finished_at").gte("created_at", since).limit(JOB_CAP),
    // Queued/processing jobs older than the window still matter for queue age.
    db.from("jobs").select("status,error,created_at,started_at,finished_at").in("status", ["queued", "processing"]).lt("created_at", since).limit(200),
    db.from("agent_runs").select("diction_qa,jobs(song_documents(language))").gte("updated_at", since).not("diction_qa", "is", null).limit(JOB_CAP),
    db.from("spend_ledger").select("provider,reserved_gbp"),
    db.from("user_spend").select("user_id,reserved_gbp").eq("period", month).order("reserved_gbp", { ascending: false }).limit(5),
  ]);
  const err = [jobs, active, diction, ledger, users].find((r) => r.error)?.error;
  if (err) throw new OpsQueryError(err.message);

  const dRows: DictionRow[] = ((diction.data ?? []) as unknown as { diction_qa: DictionRow["diction_qa"]; jobs: { song_documents: { language: string } | null } | null }[])
    .map((r) => ({ diction_qa: r.diction_qa, language: r.jobs?.song_documents?.language ?? null }));
  const summary = summarize(
    [...((jobs.data ?? []) as JobRow[]), ...((active.data ?? []) as JobRow[])],
    dRows,
    {
      // Same ceiling spendGuard() enforces (lib/agent/adapters.ts); only Lyria has one.
      global: (ledger.data ?? []).map((r) => ({
        provider: String(r.provider), reserved_gbp: Number(r.reserved_gbp),
        ...(r.provider === "lyria" ? { cap_gbp: lyriaBudgetGbp(env) } : {}),
      })),
      topUsersThisMonth: (users.data ?? []).map((r) => ({ user_id: String(r.user_id), reserved_gbp: Number(r.reserved_gbp) })),
    },
    new Date(),
    hours,
  );
  return { ...summary, truncated: (jobs.data?.length ?? 0) >= JOB_CAP };
}

export async function loadFunnel(db: SupabaseClient, days: number): Promise<FunnelSummary & { cohort_truncated: boolean }> {
  const sinceTs = new Date(Date.now() - days * 86_400_000);
  const [views, cohort, shared, gifted, campaigns] = await Promise.all([
    db.from("funnel_daily").select("day,event,n").gte("day", sinceTs.toISOString().slice(0, 10)),
    db.from("users").select("id,created_at").gte("created_at", sinceTs.toISOString()).limit(COHORT_CAP),
    db.from("jobs").select("id", { count: "exact", head: true }).in("published_visibility", ["public", "unlisted"]).gte("published_at", sinceTs.toISOString()),
    db.from("jobs").select("id", { count: "exact", head: true }).not("dedication_to", "is", null).gte("created_at", sinceTs.toISOString()),
    // Migration 0104; a missing table just means no campaign rows.
    (db as unknown as { from: (t: string) => { select: (c: string) => { gte: (k: string, v: string) => Promise<{ data: unknown[] | null; error: unknown }> } } })
      .from("funnel_campaign_daily").select("event,source,medium,campaign,content,n").gte("day", sinceTs.toISOString().slice(0, 10)),
  ]);
  const err = [views, cohort, shared, gifted].find((r) => r.error)?.error;
  if (err) throw new OpsQueryError(err.message);
  const ids = (cohort.data ?? []).map((u) => String(u.id));
  let firstSongUsers = 0;
  if (ids.length) {
    const { data, error } = await db.from("jobs").select("user_id").eq("status", "completed").in("user_id", ids).limit(5000);
    if (error) throw new OpsQueryError(error.message);
    firstSongUsers = new Set((data ?? []).map((j) => String(j.user_id))).size;
  }
  let paidUsers = 0;
  if (ids.length) {
    const { data, error } = await db.from("user_billing").select("user_id").in("status", ["active", "trialing"]).in("user_id", ids).limit(5000);
    if (error) throw new OpsQueryError(error.message);
    paidUsers = new Set((data ?? []).map((b) => String(b.user_id))).size;
  }
  return {
    ...buildFunnel((views.data ?? []) as FunnelRow[], { signups: ids.length, firstSongUsers, shared: shared.count ?? 0, gifted: gifted.count ?? 0, paidUsers, signupDays: (cohort.data ?? []).map((u) => String(u.created_at).slice(0, 10)) }, days, campaigns.error ? [] : ((campaigns.data ?? []) as CampaignRow[])),
    cohort_truncated: ids.length >= COHORT_CAP,
  };
}
