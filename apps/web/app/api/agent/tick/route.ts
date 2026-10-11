/**
 * /api/agent/tick -- cron-driven worker for the Managed Agents pipeline.
 * Claims a few queued jobs, advances every running agent run, and finalizes
 * finished ones (track row + job completed). Idempotent; safe to call often.
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this).
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkBearer } from "../../../../lib/agent/auth";
import { processJobs } from "../../../../lib/agent/process";
import { requireId } from "../../../../lib/agent/tiers";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", ...auth.diag }, { status: 401 });
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  let environmentId: string;
  try {
    environmentId = requireId("MA_ENVIRONMENT_ID", process.env.MA_ENVIRONMENT_ID, "env_");
  } catch (e) {
    return NextResponse.json({ error: "not_configured", message: (e as Error).message }, { status: 503 });
  }
  if (!geminiKey) return NextResponse.json({ error: "not_configured", message: "Missing GEMINI_API_KEY" }, { status: 503 });
  try {
    return NextResponse.json(await processJobs({ environmentId, geminiKey }));
  } catch (e) {
    return NextResponse.json({ error: "tick_failed", message: (e as Error).message }, { status: 500 });
  }
}
