/**
 * POST /api/admin/ad-spots (Bearer ADMIN_SECRET via checkAdminBearer): attaches an audio file to an ad slot.
 *
 *  multipart  file=<mp3>, slot_id=<uuid>, duration_seconds=<5-30>, ai_made=<true|false>
 *
 * Uploads `ads/<slot id>.mp3` to the `tracks` bucket and sets audio_path, duration_seconds and ai_made on the slot. Used for the
 * spoken house ads (scripts/ad-spots-render.mts renders them) and later for sponsor spots a sponsor supplies. The audio only plays
 * with ADS_AUDIO_ENABLED=1 (lib/station/ads.ts). Re-posting replaces the file. No model call and no spend.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A 30 s mono spot at 48 kbps is about 180 KB; this leaves room without letting a track through. */
const MAX_BYTES = 600_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", diag: auth.diag }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart_required" }, { status: 400 });
  }
  const slotId = String(form.get("slot_id") ?? "");
  const seconds = Math.ceil(Number(form.get("duration_seconds")));
  const file = form.get("file");
  if (!UUID.test(slotId)) return NextResponse.json({ error: "bad_slot_id" }, { status: 400 });
  if (!(seconds >= 5 && seconds <= 30)) return NextResponse.json({ error: "duration_seconds_must_be_5_to_30" }, { status: 400 });
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "file_missing_or_over_600kb" }, { status: 400 });

  const db = serviceClient();
  const slot = await db.from("ad_slots").select("id").eq("id", slotId).maybeSingle();
  if (slot.error || !slot.data) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

  const path = `ads/${slotId}.mp3`;
  const up = await db.storage.from("tracks").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: "audio/mpeg", upsert: true });
  if (up.error) return NextResponse.json({ error: "upload_failed", message: up.error.message }, { status: 502 });
  const upd = await db.from("ad_slots").update({ audio_path: path, duration_seconds: seconds, ai_made: form.get("ai_made") === "true" }).eq("id", slotId);
  if (upd.error) return NextResponse.json({ error: "update_failed", message: upd.error.message }, { status: 502 });
  return NextResponse.json({ ok: true, slot_id: slotId, audio_path: path, duration_seconds: seconds });
}
