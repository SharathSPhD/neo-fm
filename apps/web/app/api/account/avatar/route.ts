/**
 * POST   /api/account/avatar  multipart form field `file` -- upload or replace the profile picture.
 * DELETE /api/account/avatar                                -- remove it.
 *
 * Checks, in order: size, magic-byte format (png/jpeg/webp only), header-derived dimensions,
 * metadata stripped (EXIF/XMP), then a fail-closed vision moderation pass. Files are stored as
 * avatars/<user id>/<random>.<ext> in a public bucket; the previous file is deleted after the new
 * one is saved. Writes use the service client (see the bio/avatar migration).
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { anthropicClient } from "@/lib/agent/adapters";
import { moderateAvatar } from "@/lib/profile/avatar-moderation";
import { AVATAR_MAX_BYTES, AVATAR_MIME, checkAvatar } from "@/lib/profile/image";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "avatars";
// Each upload costs a vision call, so replacements are spaced out per user.
const MIN_SECONDS_BETWEEN_UPLOADS = 20;

const STATUS: Record<string, number> = {
  too_large: 413,
  unsupported_type: 415,
  corrupt: 400,
  too_small: 400,
  too_big_dimensions: 400,
};

type UserRow = { avatar_path: string | null; avatar_updated_at: string | null };

export async function POST(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const userId = authed.user.id;

  // Reject oversize bodies before buffering them.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > AVATAR_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const checked = checkAvatar(new Uint8Array(await file.arrayBuffer()));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: STATUS[checked.error] ?? 400 });

  const db = createServiceRoleClient();
  const { data: row } = await db
    .from("users")
    .select("avatar_path, avatar_updated_at" as never)
    .eq("id", userId)
    .maybeSingle<UserRow>();
  const last = row?.avatar_updated_at ? Date.parse(row.avatar_updated_at) : 0;
  if (Date.now() - last < MIN_SECONDS_BETWEEN_UPLOADS * 1000) {
    return NextResponse.json({ error: "too_many_uploads" }, { status: 429 });
  }

  const verdict = await moderateAvatar(anthropicClient(), { mediaType: AVATAR_MIME[checked.format] as never, data: checked.bytes });
  if (!verdict.allowed) return NextResponse.json({ error: "avatar_rejected", reason: verdict.reason }, { status: 422 });

  const ext = checked.format === "jpeg" ? "jpg" : checked.format;
  const path = `${userId}/${randomUUID()}.${ext}`;
  const up = await db.storage.from(BUCKET).upload(path, checked.bytes, {
    contentType: AVATAR_MIME[checked.format],
    cacheControl: "31536000",
    upsert: false,
  });
  if (up.error) return NextResponse.json({ error: "upload_failed" }, { status: 500 });

  const { error } = await db
    .from("users")
    .update({ avatar_path: path, avatar_updated_at: new Date().toISOString() } as never)
    .eq("id", userId);
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  if (row?.avatar_path) await db.storage.from(BUCKET).remove([row.avatar_path]);
  return NextResponse.json({ avatar_path: path });
}

export async function DELETE() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const db = createServiceRoleClient();
  const { data: row } = await db
    .from("users")
    .select("avatar_path" as never)
    .eq("id", authed.user.id)
    .maybeSingle<Pick<UserRow, "avatar_path">>();
  const { error } = await db
    .from("users")
    .update({ avatar_path: null } as never)
    .eq("id", authed.user.id);
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  if (row?.avatar_path) await db.storage.from(BUCKET).remove([row.avatar_path]);
  return NextResponse.json({ avatar_path: null });
}
