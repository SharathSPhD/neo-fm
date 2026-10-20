/**
 * POST /api/admin/pool-mirror (Bearer ADMIN_SECRET via checkAdminBearer): copies admitted station-pool audio from Supabase
 * Storage to the R2 bucket (same object keys) so the queue route can serve it from POOL_CDN_BASE. Read-only on Supabase.
 *
 *   POST                     dry run: counts what is already in R2 and what is missing. Writes nothing.
 *   POST ?apply=1[&limit=12] copies up to `limit` missing tracks (default 12, max 30) and reports counts; call again until missing is 0.
 *
 * Idempotent: objects that answer HEAD 200 are skipped. Run it again after new tracks are admitted, before relying on
 * POOL_CDN_BASE for them. Never returns credentials.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { r2Configured, r2Key, r2Request } from "../../../../lib/pool/r2";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", diag: auth.diag }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ error: "r2_not_configured" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const apply = sp.get("apply") === "1";
  const limit = Math.min(30, Math.max(1, Number(sp.get("limit")) || 12));
  const admin = serviceClient();
  const { data, error } = await admin.from("pool_tracks").select("audio_path").eq("status", "admitted");
  if (error || !data) return NextResponse.json({ error: "pool_read_failed" }, { status: 500 });

  const present: string[] = [];
  const missing: string[] = [];
  for (const { audio_path } of data as { audio_path: string }[]) {
    const key = r2Key(audio_path);
    if (!key || key.includes("..")) continue;
    ((await r2Request("HEAD", key)).status === 200 ? present : missing).push(key);
  }
  let copied = 0;
  const failed: { key: string; status: number }[] = [];
  if (apply) {
    for (const key of missing.slice(0, limit)) {
      const src = await admin.storage.from("tracks").download(key);
      if (!src.data) {
        failed.push({ key, status: 0 });
        continue;
      }
      const put = await r2Request("PUT", key, Buffer.from(await src.data.arrayBuffer()));
      if (put.ok) copied++;
      else failed.push({ key, status: put.status });
    }
  }
  return NextResponse.json({ total: present.length + missing.length, present: present.length, missing: missing.length - copied, copied, failed, apply });
}
