/**
 * GET /api/admin/ma-session?job=<jobId> -- read-only summary of a job's Managed Agents
 * session (event type counts, recent events, status). Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET.
 * Output is truncated and never includes credentials.
 */
import { NextResponse, type NextRequest } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", ...auth.diag }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "job required" }, { status: 400 });

  const { data: run } = await serviceClient().from("agent_runs").select("session_id,status,lyria_calls").eq("job_id", jobId).maybeSingle();
  if (!run?.session_id) return NextResponse.json({ error: "no_session", run });

  const client = anthropicClient();
  const session = await client.beta.sessions.retrieve(run.session_id);
  const events: Record<string, unknown>[] = [];
  for await (const e of client.beta.sessions.events.list(run.session_id)) events.push(e as unknown as Record<string, unknown>);

  const counts: Record<string, number> = {};
  for (const e of events) counts[String(e.type)] = (counts[String(e.type)] ?? 0) + 1;
  const brief = (e: Record<string, unknown>) => {
    const out: Record<string, unknown> = { type: e.type, id: e.id };
    for (const k of ["name", "evaluated_permission", "stop_reason", "outcome", "result", "status"]) if (e[k] !== undefined) out[k] = e[k];
    if (Array.isArray(e.content)) {
      out.text = (e.content as { type?: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").slice(0, 300);
    }
    return out;
  };
  return NextResponse.json({
    run,
    session_status: (session as { status?: string }).status,
    usage: (session as { usage?: unknown }).usage ?? null,
    total_events: events.length,
    counts,
    last_events: events.slice(-12).map(brief),
  });
}
