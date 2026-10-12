/**
 * GET /api/admin/q?table=jobs&select=id,status&order=created_at.desc&limit=20&eq.status=completed&neq.x=y&gte.col=v
 * Read-only PostgREST-style query over an allow-list of tables (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 * Exists so operators/agents can inspect state without a raw-SQL surface. Never writes; rows are capped at 200.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";

export const dynamic = "force-dynamic";

const TABLES = new Set([
  "jobs", "agent_runs", "tracks", "song_documents", "eval_runs", "eval_judgments", "job_telemetry", "job_assignments",
  "feedback_events", "config_versions", "song_reports", "user_spend", "spend_ledger", "user_billing", "users",
]);
const COL = /^[a-z_][a-z0-9_]*$/i;
const SELECT = /^[a-z0-9_,()*:>.\- ]+$/i;

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const table = p.get("table") ?? "";
  if (!TABLES.has(table)) return NextResponse.json({ error: "table_not_allowed", allowed: [...TABLES] }, { status: 400 });
  const select = p.get("select") ?? "*";
  if (!SELECT.test(select)) return NextResponse.json({ error: "bad_select" }, { status: 400 });
  let q = serviceClient().from(table).select(select, { count: p.get("count") ? "exact" : undefined });
  for (const [k, v] of p.entries()) {
    const m = k.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|is)\.([a-z_][a-z0-9_]*)$/i);
    if (!m) continue;
    const [, op, col] = m;
    if (!COL.test(col!)) continue;
    const val: unknown = op === "is" ? (v === "null" ? null : v === "true" ? true : v === "false" ? false : v) : v;
    q = (q as unknown as Record<string, (c: string, x: unknown) => typeof q>)[op!]!(col!, val);
  }
  const order = p.get("order");
  if (order) { const [c, d] = order.split("."); if (c && COL.test(c)) q = q.order(c, { ascending: d !== "desc" }); }
  q = q.limit(Math.min(200, Math.max(1, Number(p.get("limit") ?? 50))));
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ count: count ?? undefined, rows: data });
}
