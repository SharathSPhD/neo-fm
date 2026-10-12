/** GET /api/admin/diction-qa?job=<id> -- (re)run the Gemini diction audit for one finished job and return the stored result. Bearer CRON_SECRET / AGENT_TICK_SECRET. */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { qaDiction } from "../../../../lib/agent/process";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = req.nextUrl.searchParams.get("job");
  const key = process.env.GEMINI_API_KEY;
  if (!job || !key) return NextResponse.json({ error: "job and GEMINI_API_KEY required", has_key: Boolean(key) }, { status: 400 });
  const db = serviceClient();
  const { data: docs } = await db.from("jobs").select("song_documents(language)").eq("id", job).limit(1);
  const lang = ((docs ?? [])[0] as unknown as { song_documents: { language: string } | null } | undefined)?.song_documents?.language ?? "hi";
  await db.from("agent_runs").update({ diction_qa: null }).eq("job_id", job);
  const r = await qaDiction(db, job, lang, key);
  const { data: row } = await db.from("agent_runs").select("diction_qa").eq("job_id", job).limit(1);
  return NextResponse.json({ result: r, stored: ((row ?? [])[0] as { diction_qa: unknown } | undefined)?.diction_qa ?? null });
}
