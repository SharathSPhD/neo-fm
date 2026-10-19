/**
 * POST /api/admin/voice-mirror (Bearer ADMIN_SECRET via checkAdminBearer): copies the station's spoken segments (the static
 * files under /voice, listed in lib/station/voice-links.ts) into the R2 bucket as `voice/<id>.mp3`, so the queue route can
 * serve them from POOL_CDN_BASE when STATION_VOICE_CDN=1. No model call and no spend.
 *
 *   POST                dry run: counts what R2 already has. Writes nothing.
 *   POST ?apply=1       copies up to 30 missing files; call again until missing is 0.
 *
 * Idempotent: objects that answer HEAD 200 are skipped. Never returns credentials.
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkAdminBearer } from "../../../../lib/agent/auth";
import { r2Configured, r2Request } from "../../../../lib/pool/r2";
import { VOICE_LINES } from "../../../../lib/station/voice-links";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", diag: auth.diag }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ error: "r2_not_configured" }, { status: 503 });

  const apply = req.nextUrl.searchParams.get("apply") === "1";
  const missing: string[] = [];
  let present = 0;
  for (const { id } of VOICE_LINES) {
    if ((await r2Request("HEAD", `voice/${id}.mp3`)).status === 200) present++;
    else missing.push(id);
  }
  let copied = 0;
  const failed: { id: string; status: number }[] = [];
  if (apply) {
    for (const id of missing.slice(0, 30)) {
      const src = await fetch(new URL(`/voice/${id}.mp3`, req.nextUrl.origin), { cache: "no-store" });
      if (!src.ok) { failed.push({ id, status: src.status }); continue; }
      const put = await r2Request("PUT", `voice/${id}.mp3`, Buffer.from(await src.arrayBuffer()));
      if (put.ok) copied++;
      else failed.push({ id, status: put.status });
    }
  }
  return NextResponse.json({ total: VOICE_LINES.length, present, missing: missing.length - copied, copied, failed, apply });
}
