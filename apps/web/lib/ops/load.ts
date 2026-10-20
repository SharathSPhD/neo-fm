/** Shared read paths for the ops routes and the daily snapshot. Read-only. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildFunnel, type CampaignRow, type FunnelRow, type FunnelSummary } from "./funnel";
import { buildPullFunnel, type ActivityRow, type CohortUser, type PullFunnel } from "./pull-funnel";
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
    // Migration 0105; a missing table just means no campaign rows.
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

const CHUNK = 150;
const ACTIVITY_CAP = 20_000;

/** Visit to first play to return day 1 and day 7. Activity is a station play/finish/like or a created song. */
export async function loadPullFunnel(db: SupabaseClient, days: number): Promise<PullFunnel & { cohort_truncated: boolean }> {
  const sinceTs = new Date(Date.now() - days * 86_400_000);
  const [counters, cohort] = await Promise.all([
    db.from("funnel_daily").select("event,n").gte("day", sinceTs.toISOString().slice(0, 10)).in("event", ["landing_view", "station_play_anon"]),
    db.from("users").select("id,created_at").gte("created_at", sinceTs.toISOString()).limit(COHORT_CAP),
  ]);
  const err = [counters, cohort].find((r) => r.error)?.error;
  if (err) throw new OpsQueryError(err.message);
  const users = (cohort.data ?? []).map((u) => ({ id: String(u.id), created_at: String(u.created_at) })) as CohortUser[];
  const sum = (event: string) => (counters.data ?? []).filter((r) => r.event === event).reduce((a, r) => a + Number(r.n), 0);

  const activity: ActivityRow[] = [];
  const trackLanguage = new Map<string, string>();
  const trackSeconds = new Map<string, number>();
  for (let i = 0; i < users.length && activity.length < ACTIVITY_CAP; i += CHUNK) {
    const ids = users.slice(i, i + CHUNK).map((u) => u.id);
    const [signals, jobs] = await Promise.all([
      db.from("station_signals").select("user_id,track_id,kind,position_ms,created_at").in("user_id", ids).in("kind", ["play", "finish", "like", "skip", "replay", "share"]).gte("created_at", sinceTs.toISOString()).limit(5000),
      db.from("jobs").select("user_id,created_at,song_documents(language)").in("user_id", ids).gte("created_at", sinceTs.toISOString()).limit(5000),
    ]);
    // A missing station_signals table (older environments) just means song activity only.
    if (jobs.error) throw new OpsQueryError(jobs.error.message);
    const signalRows = (signals.error ? [] : (signals.data ?? [])) as { user_id: string; track_id: string; kind: string; position_ms: number | null; created_at: string }[];
    // Track languages and lengths come from the pool; a failed read leaves those rows without them.
    const unseen = [...new Set(signalRows.map((r) => String(r.track_id)))].filter((t) => !trackLanguage.has(t));
    for (let j = 0; j < unseen.length; j += CHUNK) {
      const { data } = await db.from("pool_tracks").select("id,language,duration_seconds").in("id", unseen.slice(j, j + CHUNK));
      for (const t of data ?? []) {
        trackLanguage.set(String(t.id), String(t.language));
        trackSeconds.set(String(t.id), Number(t.duration_seconds) || 0);
      }
    }
    for (const r of signalRows) {
      const listen_ms = r.kind === "finish" ? (trackSeconds.get(String(r.track_id)) ?? 0) * 1000 : r.kind === "skip" || r.kind === "replay" ? Math.max(0, Number(r.position_ms) || 0) : 0;
      activity.push({
        user_id: String(r.user_id), created_at: String(r.created_at), language: trackLanguage.get(String(r.track_id)) ?? null,
        listen_ms, shared: r.kind === "share",
      });
    }
    for (const r of (jobs.data ?? []) as unknown as { user_id: string; created_at: string; song_documents: { language: string } | { language: string }[] | null }[]) {
      const doc = Array.isArray(r.song_documents) ? r.song_documents[0] : r.song_documents;
      activity.push({ user_id: String(r.user_id), created_at: String(r.created_at), language: doc?.language ?? null });
    }
  }
  return {
    ...buildPullFunnel(users, activity, { visits: sum("landing_view"), anonStationPlays: sum("station_play_anon") }, days),
    cohort_truncated: users.length >= COHORT_CAP || activity.length >= ACTIVITY_CAP,
  };
}
