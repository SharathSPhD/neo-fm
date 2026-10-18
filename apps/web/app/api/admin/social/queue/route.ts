/**
 * /api/admin/social/queue (Bearer ADMIN_SECRET)
 *  GET                                         list rows and connected accounts (no tokens).
 *  POST {action:"enqueue", pool_track_id, video_path, platforms[], scheduled_at?}
 *       builds the caption from the admitted pool track (pool tracks only) and inserts a `draft` row per platform.
 *  POST {action:"approve", id, approval_note, visibility?, native_read_ok?}
 *       approval_note must quote S's own words; nothing publishes before this. Public needs visibility "public".
 *  POST {action:"upload_url", video_path}
 *       signed one-shot upload URL into the private social-videos bucket (PUT the mp4 to it), so clips can be added
 *       without a storage key on the caller's side.
 *  POST {action:"skip", id}
 *  POST {action:"promote", id, approval_note}
 *       YouTube only: a row that is already published (private) goes public and into YOUTUBE_PLAYLIST_ID. Needs
 *       SOCIAL_ALLOW_PUBLIC=1 and an approval_note quoting S's own words naming this video.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../../lib/agent/auth";
import { buildPost } from "../../../../../lib/social/caption";
import { isPlatform, type Platform } from "../../../../../lib/social/config";
import { open } from "../../../../../lib/social/crypto";
import { promoteYoutube } from "../../../../../lib/social/platforms/youtube";
import { socialFlags } from "../../../../../lib/social/config";
import { siteBase } from "../../../../../lib/social/site";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_PATH = /^[A-Za-z0-9_\-./]{3,200}$/;

export async function GET(req: NextRequest) {
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const posts = await db.from("social_posts").select("id,platform,status,visibility,title,caption,needs_native_read,native_read_ok,approved_at,scheduled_at,external_url,error,pool_track_id").order("created_at", { ascending: false }).limit(100);
  if (posts.error) return NextResponse.json({ error: posts.error.message, hint: "migration 0103 not applied?" }, { status: 503 });
  const accounts = await db.from("social_accounts").select("platform,label,connected_at");
  return NextResponse.json({ posts: posts.data, accounts: accounts.data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const db = serviceClient();

  if (body.action === "upload_url") {
    const path = String(body.video_path ?? "");
    if (!SAFE_PATH.test(path) || !path.endsWith(".mp4")) return NextResponse.json({ error: "video_path must be a safe .mp4 path" }, { status: 400 });
    const { data, error } = await db.storage.from("social-videos").createSignedUploadUrl(path);
    return error || !data ? NextResponse.json({ error: error?.message ?? "no url" }, { status: 500 }) : NextResponse.json({ signed_url: data.signedUrl });
  }

  if (body.action === "enqueue") {
    const trackId = String(body.pool_track_id ?? "");
    const path = String(body.video_path ?? "");
    const platforms = (Array.isArray(body.platforms) ? body.platforms : []).map(String).filter(isPlatform) as Platform[];
    if (!UUID.test(trackId) || !SAFE_PATH.test(path) || platforms.length === 0) return NextResponse.json({ error: "pool_track_id, video_path, platforms required" }, { status: 400 });
    // Pool tracks only: a listener's own song never enters this queue.
    const { data: t } = await db.from("pool_tracks").select("title,language,genre,mood").eq("id", trackId).eq("status", "admitted").maybeSingle();
    if (!t) return NextResponse.json({ error: "not an admitted pool track" }, { status: 404 });
    const rows = platforms.map((p) => {
      const post = buildPost({ title: t.title, language: t.language, genre: t.genre, mood: t.mood }, p, trackId, siteBase());
      return { pool_track_id: trackId, platform: p, video_path: path, title: post.title, caption: post.caption, needs_native_read: post.needsNativeRead, status: "draft", scheduled_at: typeof body.scheduled_at === "string" ? body.scheduled_at : new Date().toISOString() };
    });
    const { error } = await db.from("social_posts").upsert(rows, { onConflict: "pool_track_id,platform,video_path", ignoreDuplicates: true });
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ queued: rows.length });
  }

  const id = String(body.id ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (body.action === "skip") {
    const { error } = await db.from("social_posts").update({ status: "skipped" }).eq("id", id).in("status", ["draft", "approved"]);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (body.action === "approve") {
    const note = String(body.approval_note ?? "").trim();
    if (note.length < 8) return NextResponse.json({ error: "approval_note must quote S's own words" }, { status: 400 });
    const patch: Record<string, unknown> = { status: "approved", approved_at: new Date().toISOString(), approval_note: note.slice(0, 500), visibility: body.visibility === "public" ? "public" : "private" };
    if (body.native_read_ok === true) patch.native_read_ok = true;
    const { error } = await db.from("social_posts").update(patch).eq("id", id).eq("status", "draft");
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (body.action === "promote") {
    const note = String(body.approval_note ?? "").trim();
    if (note.length < 8) return NextResponse.json({ error: "approval_note must quote S's own words" }, { status: 400 });
    if (!socialFlags(process.env).allowPublic) return NextResponse.json({ error: "SOCIAL_ALLOW_PUBLIC is not 1" }, { status: 409 });
    const { data: row } = await db.from("social_posts").select("platform,status,external_id").eq("id", id).maybeSingle();
    if (!row || row.platform !== "youtube" || row.status !== "published" || !row.external_id) return NextResponse.json({ error: "not a published youtube row" }, { status: 409 });
    const { data: acct } = await db.from("social_accounts").select("secret_sealed,extra").eq("platform", "youtube").maybeSingle();
    if (!acct) return NextResponse.json({ error: "youtube not connected" }, { status: 409 });
    try {
      const res = await promoteYoutube(String(row.external_id), { secret: open(String(acct.secret_sealed), process.env), extra: (acct.extra ?? {}) as Record<string, string> }, process.env, fetch);
      await db.from("social_posts").update({ visibility: "public", approval_note: note.slice(0, 500) }).eq("id", id);
      return NextResponse.json({ ok: true, ...res });
    } catch (e) {
      return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
