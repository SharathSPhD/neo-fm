/**
 * /api/admin/purge-listens -- daily retention job for anonymous listener events.
 * Rolls song_listens rows older than 90 days into language-free daily counts and deletes them (public.purge_song_listens).
 * Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET (Vercel Cron sends GET).
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await serviceClient().rpc("purge_song_listens", { p_keep_days: 90 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, purged: Number(data ?? 0) });
}
