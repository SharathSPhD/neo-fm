/**
 * Abuse-report review: queue listing and resolution (takedown / dismiss / reinstate). Used by /api/admin/reports*.
 * Takedown makes the song private and flags it (migration 0069) so the owner cannot re-publish it; everything is
 * applied per job, because several reports on one song are one decision.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { reporterOutcome, takedownNotice, type Mailer } from "../email/moderation";

export type ResolveAction = "takedown" | "dismiss" | "reinstate";

export interface QueueItem {
  job_id: string;
  public_id: string | null;
  title: string | null;
  visibility: string;
  moderation_status: string;
  report_count: number;
  categories: string[];
  oldest_report_at: string;
  reports: { id: string; category: string | null; details: string | null; created_at: string }[];
}

type ReportRow = { id: string; job_id: string; reporter_id: string | null; category: string | null; details: string | null; reason: string; created_at: string };
type JobRow = { id: string; user_id: string; public_id: string | null; published_visibility: string; moderation_status: string; song_documents: { title: string | null } | { title: string | null }[] | null };

const titleOf = (j: JobRow) => (Array.isArray(j.song_documents) ? j.song_documents[0]?.title : j.song_documents?.title) ?? null;

export async function listQueue(db: SupabaseClient, limit = 100): Promise<QueueItem[]> {
  const { data: reports, error } = await db.from("song_reports")
    .select("id,job_id,reporter_id,category,details,reason,created_at").eq("status", "open").order("created_at", { ascending: true }).limit(500);
  if (error) throw new Error(`song_reports: ${error.message}`);
  const byJob = new Map<string, ReportRow[]>();
  for (const r of (reports ?? []) as ReportRow[]) byJob.set(r.job_id, [...(byJob.get(r.job_id) ?? []), r]);
  if (!byJob.size) return [];
  const { data: jobs, error: je } = await db.from("jobs")
    .select("id,user_id,public_id,published_visibility,moderation_status,song_documents(title)").in("id", [...byJob.keys()]);
  if (je) throw new Error(`jobs: ${je.message}`);
  const items = ((jobs ?? []) as unknown as JobRow[]).map((j): QueueItem => {
    const rs = byJob.get(j.id) ?? [];
    return {
      job_id: j.id, public_id: j.public_id, title: titleOf(j), visibility: j.published_visibility, moderation_status: j.moderation_status,
      report_count: rs.length, categories: [...new Set(rs.map((r) => r.category ?? "other"))], oldest_report_at: rs[0]!.created_at,
      reports: rs.map((r) => ({ id: r.id, category: r.category, details: r.details, created_at: r.created_at })),
    };
  });
  // Most-reported first, then oldest, so the queue works worst-first.
  return items.sort((a, b) => b.report_count - a.report_count || a.oldest_report_at.localeCompare(b.oldest_report_at)).slice(0, limit);
}

export interface ResolveResult { ok: true; resolved_reports: number; notified: { owner: boolean; reporters: number } }

export async function resolveJobReports(
  db: SupabaseClient, mail: Mailer, args: { jobId: string; action: ResolveAction; note?: string; now?: Date },
): Promise<ResolveResult | { ok: false; error: "not_found" | "db_error"; detail?: string }> {
  const note = (args.note ?? "").trim().slice(0, 500);
  const nowIso = (args.now ?? new Date()).toISOString();
  const { data: job } = await db.from("jobs")
    .select("id,user_id,public_id,published_visibility,moderation_status,song_documents(title)").eq("id", args.jobId).maybeSingle();
  if (!job) return { ok: false, error: "not_found" };
  const j = job as unknown as JobRow;

  const { data: open } = await db.from("song_reports").select("id,job_id,reporter_id,category,details,reason,created_at").eq("job_id", args.jobId).eq("status", "open");
  const reports = (open ?? []) as ReportRow[];

  if (args.action === "reinstate") {
    // Lifts the publish block only; the owner chooses whether to publish again.
    const { error } = await db.from("jobs").update({ moderation_status: "ok", taken_down_at: null, takedown_reason: null }).eq("id", args.jobId);
    return error ? { ok: false, error: "db_error", detail: error.message } : { ok: true, resolved_reports: 0, notified: { owner: false, reporters: 0 } };
  }

  if (args.action === "takedown") {
    const category = reports[0]?.category ?? null;
    const { error } = await db.from("jobs").update({
      published_visibility: "private", moderation_status: "taken_down", taken_down_at: nowIso, takedown_reason: note || category || "policy",
    }).eq("id", args.jobId);
    if (error) return { ok: false, error: "db_error", detail: error.message };
  }

  if (reports.length) {
    const { error } = await db.from("song_reports")
      .update({ status: args.action === "takedown" ? "actioned" : "dismissed", resolved_at: nowIso, resolution_note: note || null })
      .eq("job_id", args.jobId).eq("status", "open");
    if (error) return { ok: false, error: "db_error", detail: error.message };
  }

  // Emails are best-effort: the decision is already recorded, so a mail failure must not undo or fail it.
  let owner = false; let reporters = 0;
  const emailOf = async (id: string) => {
    try { return (await db.auth.admin.getUserById(id)).data.user?.email ?? null; } catch { return null; }
  };
  try {
    if (args.action === "takedown") {
      const to = await emailOf(j.user_id);
      if (to) owner = (await mail({ to, ...takedownNotice({ title: titleOf(j), category: reports[0]?.category ?? null, note }) })).sent;
    }
    for (const id of new Set(reports.map((r) => r.reporter_id).filter((x): x is string => !!x))) {
      const to = await emailOf(id);
      if (to && (await mail({ to, ...reporterOutcome({ action: args.action }) })).sent) reporters++;
    }
  } catch (e) { console.warn("[moderation] email failed", e instanceof Error ? e.message : e); }
  return { ok: true, resolved_reports: reports.length, notified: { owner, reporters } };
}
