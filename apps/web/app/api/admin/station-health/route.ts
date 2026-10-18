/**
 * GET /api/admin/station-health[?hours=24] -- listening health for /station: signals per listener, skip and finish
 * rate, audio-load failures and empty queues. Read-only, Bearer CRON_SECRET / AGENT_TICK_SECRET like the other admin
 * endpoints. Degrades to an empty summary note when station_signals is not there yet.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { STATION_AUDIO_FAILED, STATION_QUEUE_EMPTY, summarizeStation } from "../../../../lib/ops/station-health";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ROW_CAP = 20_000;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const hours = Math.min(168, Math.max(1, Number(req.nextUrl.searchParams.get("hours") ?? 24) || 24));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const db = serviceClient();
  const [signals, errors] = await Promise.all([
    db.from("station_signals").select("user_id,kind").gte("created_at", since).limit(ROW_CAP),
    db.from("client_errors").select("message").or(`message.like.${STATION_AUDIO_FAILED}%,message.like.${STATION_QUEUE_EMPTY}%`).gte("created_at", since).limit(ROW_CAP),
  ]);
  const err = [signals, errors].find((r) => r.error)?.error;
  if (err) return NextResponse.json({ error: "query_failed", detail: err.message }, { status: 502 });
  const summary = summarizeStation(signals.data ?? [], errors.data ?? [], hours);
  return NextResponse.json({ ...summary, truncated: (signals.data?.length ?? 0) >= ROW_CAP });
}
