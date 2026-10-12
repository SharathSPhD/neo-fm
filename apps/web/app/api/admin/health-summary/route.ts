/**
 * GET /api/admin/health-summary[?hours=24][&format=text]
 * Read-only ops snapshot for the daily routine (Bearer CRON_SECRET / AGENT_TICK_SECRET). Never writes.
 * Job rows are capped, so on a very busy window the counts are a floor, flagged by `truncated`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { alertString, summarize, type DictionRow, type JobRow } from "../../../../lib/ops/health-summary";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const JOB_CAP = 2000;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const hours = Math.min(168, Math.max(1, Number(p.get("hours") ?? 24) || 24));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const db = serviceClient();
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
  if (err) return NextResponse.json({ error: "query_failed", detail: err.message }, { status: 502 });

  const dRows: DictionRow[] = ((diction.data ?? []) as unknown as { diction_qa: DictionRow["diction_qa"]; jobs: { song_documents: { language: string } | null } | null }[])
    .map((r) => ({ diction_qa: r.diction_qa, language: r.jobs?.song_documents?.language ?? null }));
  const summary = summarize(
    [...((jobs.data ?? []) as JobRow[]), ...((active.data ?? []) as JobRow[])],
    dRows,
    {
      // Same ceiling spendGuard() enforces (lib/agent/adapters.ts); only Lyria has one.
      global: (ledger.data ?? []).map((r) => ({
        provider: String(r.provider), reserved_gbp: Number(r.reserved_gbp),
        ...(r.provider === "lyria" ? { cap_gbp: Number(process.env.LYRIA_BUDGET_GBP ?? "3") } : {}),
      })),
      topUsersThisMonth: (users.data ?? []).map((r) => ({ user_id: String(r.user_id), reserved_gbp: Number(r.reserved_gbp) })),
    },
    new Date(),
    hours,
  );
  const truncated = (jobs.data?.length ?? 0) >= JOB_CAP;
  if (p.get("format") === "text") {
    return new NextResponse(alertString(summary) + (truncated ? " (truncated)" : "") + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.json({ ...summary, truncated, text: alertString(summary) });
}
