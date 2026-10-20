/**
 * GET /api/station/track-url?id=<pool track id> -- a short-lived Supabase signed URL for one admitted pool track.
 * The player falls back to it when the CDN (POOL_CDN_BASE, R2) URL fails to load, so playback never dies on the CDN path.
 * Pool tracks are shared, public-by-design audio; unknown or not-admitted ids get 404.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "@/lib/agent/adapters";

export const dynamic = "force-dynamic";

const URL_TTL_SECONDS = 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const admin = serviceClient();
  const { data } = await admin.from("pool_tracks").select("audio_path").eq("id", id).eq("status", "admitted").maybeSingle();
  const path = (data as { audio_path?: string } | null)?.audio_path;
  if (!path) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const signed = await admin.storage.from("tracks").createSignedUrl(path.replace(/^tracks\//, ""), URL_TTL_SECONDS);
  if (!signed.data?.signedUrl) return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  return NextResponse.json({ url: signed.data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
