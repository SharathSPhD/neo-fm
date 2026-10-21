/**
 * GET /api/admin/listening[?days=7] -- listening-time analytics for the sponsor media kit: session length, tracks per
 * session, skip rate and ad-break completion by language and daypart. Aggregated only (no user or track ids) and cells under
 * 5 distinct listeners are suppressed. Bearer admin like the other admin endpoints. Read-only; ad cells are empty before migration 0099.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { listeningReport } from "../../../../lib/ops/listening-report";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const SIGNAL_CAP = 50_000;
const CHUNK = 200;

type Rows = { data: Record<string, unknown>[] | null; error?: { message: string } | null };

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = serviceClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        gte: (k: string, v: string) => { limit: (n: number) => Promise<Rows> };
        in: (k: string, v: string[]) => Promise<Rows>;
        limit: (n: number) => Promise<Rows>;
      };
    };
  };
  const signals = await db.from("station_signals").select("user_id,track_id,kind,created_at").gte("created_at", since).limit(SIGNAL_CAP);
  if (signals.error) return NextResponse.json({ error: "query_failed", detail: signals.error.message }, { status: 502 });
  const rows = (signals.data ?? []) as { user_id: string; track_id: string; kind: string; created_at: string }[];

  // Track languages come from the pool; a failed read leaves those plays under "unknown".
  const trackLanguage = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => String(r.track_id)))];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await db.from("pool_tracks").select("id,language").in("id", ids.slice(i, i + CHUNK));
    for (const t of data ?? []) trackLanguage.set(String(t.id), String(t.language));
  }

  // Missing ad tables (older environments) read as no ad events.
  let events: Rows = { data: [] };
  let slots: Rows = { data: [] };
  try {
    [slots, events] = await Promise.all([
      db.from("ad_slots").select("id,languages").limit(200),
      db.from("ad_events").select("slot_id,event,created_at").gte("created_at", since).limit(20_000),
    ]);
  } catch { /* ad cells stay empty */ }
  if (slots.error || events.error) { slots = { data: [] }; events = { data: [] }; }

  const report = listeningReport(rows, trackLanguage, (events.data ?? []) as never, (slots.data ?? []) as never, days);
  return NextResponse.json({ ...report, truncated: rows.length >= SIGNAL_CAP });
}
