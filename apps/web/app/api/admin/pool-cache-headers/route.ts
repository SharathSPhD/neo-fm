/**
 * POST /api/admin/pool-cache-headers (Bearer ADMIN_SECRET via checkAdminBearer): backfills a long, immutable Cache-Control on
 * admitted station-pool audio and the spoken `voice/<id>.mp3` segments already in R2, which were uploaded without one and are
 * served no-cache. New mirrors set it on PUT
 * (lib/pool/r2.ts), so this only needs to run once. Read-only on Supabase; rewrites object metadata in R2 only.
 *
 *   POST                     dry run: counts objects with the right Cache-Control, the ones that need it, and any not in R2.
 *   POST ?apply=1[&limit=25] rewrites up to `limit` objects (default 25, max 60); call again until stale is 0.
 *
 * Idempotent: objects whose HEAD already reports the target Cache-Control are skipped. Never returns credentials.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { renderedProgrammes } from "../../../../lib/station/programmes";
import { VOICE_LINES } from "../../../../lib/station/voice-links";
import { POOL_CACHE_CONTROL, r2Configured, r2Key, r2Request, r2SetPoolCacheControl } from "../../../../lib/pool/r2";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", diag: auth.diag }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ error: "r2_not_configured" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const apply = sp.get("apply") === "1";
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit")) || 25));
  const { data, error } = await serviceClient().from("pool_tracks").select("audio_path").eq("status", "admitted");
  if (error || !data) return NextResponse.json({ error: "pool_read_failed" }, { status: 500 });

  const keys = [
    ...(data as { audio_path: string }[]).map((r) => r2Key(r.audio_path)),
    ...[...VOICE_LINES, ...renderedProgrammes()].map((l) => `voice/${l.id}.mp3`),
  ];
  let ok = 0;
  let notInR2 = 0;
  const stale: string[] = [];
  for (const key of keys) {
    if (!key || key.includes("..")) continue;
    const head = await r2Request("HEAD", key);
    if (head.status !== 200) notInR2++;
    else if (head.headers.get("cache-control") === POOL_CACHE_CONTROL) ok++;
    else stale.push(key);
  }
  let updated = 0;
  const failed: { key: string; status: number }[] = [];
  if (apply) {
    for (const key of stale.slice(0, limit)) {
      const res = await r2SetPoolCacheControl(key);
      if (res.ok) updated++;
      else failed.push({ key, status: res.status });
    }
  }
  return NextResponse.json({ total: ok + notInR2 + stale.length, ok, stale: stale.length - updated, notInR2, updated, failed, apply });
}
