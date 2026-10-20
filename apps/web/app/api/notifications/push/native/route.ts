/**
 * POST   /api/notifications/push/native  { token, platform: "android" }
 * DELETE /api/notifications/push/native  { token }
 *
 * Stores the caller's app (FCM) push token. The token is credential-like and later POSTed to FCM, so it is only ever
 * read by the service role. At most MAX_TOKENS per user: the oldest is dropped to make room. 404 while native push is
 * not configured, 503 while the table (migration 0112) is not applied, so deploying this changes nothing by default.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fcmConfig } from "../../../../../lib/notifications/fcm";
import { notificationsDb } from "../../../../../lib/notifications/db";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const MAX_TOKENS = 5;

const Body = z.object({ token: z.string().min(20).max(4096), platform: z.literal("android") });
const DeleteBody = z.object({ token: z.string().min(20).max(4096) });

/** Postgres "undefined_table" (and PostgREST's schema-cache miss): the migration is not applied yet. */
const missingTable = (e: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";

export async function POST(request: NextRequest) {
  if (!fcmConfig()) return NextResponse.json({ error: "push_disabled" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { token, platform } = parsed.data;

  const sb = notificationsDb();
  const { data: existing, error: readErr } = await sb
    .from("native_push_tokens")
    .select("id, token, created_at")
    .eq("user_id", authed.user.id)
    .order("created_at", { ascending: true })
    .returns<{ id: string; token: string; created_at: string }[]>();
  if (missingTable(readErr)) return NextResponse.json({ error: "push_unavailable" }, { status: 503 });
  const mine = existing ?? [];
  if (!mine.some((t) => t.token === token)) {
    const overflow = mine.length - (MAX_TOKENS - 1);
    if (overflow > 0) await sb.from("native_push_tokens").delete().in("id", mine.slice(0, overflow).map((t) => t.id));
  }
  // A token is unique across users: signing in on a shared phone moves it to the current user.
  const { error } = await sb
    .from("native_push_tokens")
    .upsert({ user_id: authed.user.id, platform, token, last_seen_at: new Date().toISOString() }, { onConflict: "token" });
  if (error) return NextResponse.json({ error: missingTable(error) ? "push_unavailable" : "db_error" }, { status: missingTable(error) ? 503 : 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!fcmConfig()) return NextResponse.json({ error: "push_disabled" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = DeleteBody.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { error } = await notificationsDb().from("native_push_tokens").delete().eq("user_id", authed.user.id).eq("token", parsed.data.token);
  if (error) return NextResponse.json({ error: missingTable(error) ? "push_unavailable" : "db_error" }, { status: missingTable(error) ? 503 : 500 });
  return NextResponse.json({ ok: true });
}
