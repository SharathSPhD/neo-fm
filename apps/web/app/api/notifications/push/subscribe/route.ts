/**
 * POST   /api/notifications/push/subscribe  { endpoint, keys: { p256dh, auth }, userAgent? }
 * DELETE /api/notifications/push/subscribe  { endpoint }
 *
 * Stores a browser push subscription for the caller. The endpoint is
 * credential-like and later POSTed to by the server, so it must be https on
 * a known push-service host. At most MAX_SUBSCRIPTIONS per user: the oldest
 * is dropped to make room. 404 while push is not configured.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { notificationsDb } from "../../../../../lib/notifications/db";
import { b64uDecode, isAllowedEndpoint, pushConfig } from "../../../../../lib/notifications/push";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const MAX_SUBSCRIPTIONS = 5;

const SubscribeBody = z.object({
  endpoint: z.string().url().max(1000).refine(isAllowedEndpoint, "endpoint host not allowed"),
  keys: z.object({
    p256dh: z.string().max(200).refine((v) => b64uDecode(v).length === 65, "bad p256dh"),
    auth: z.string().max(100).refine((v) => b64uDecode(v).length === 16, "bad auth"),
  }),
  userAgent: z.string().max(300).optional(),
});

export async function POST(request: NextRequest) {
  if (!pushConfig()) return NextResponse.json({ error: "push_disabled" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = SubscribeBody.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { endpoint, keys, userAgent } = parsed.data;

  const sb = notificationsDb();
  const { data: existing } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, created_at")
    .eq("user_id", authed.user.id)
    .order("created_at", { ascending: true })
    .returns<{ id: string; endpoint: string; created_at: string }[]>();
  const mine = existing ?? [];
  const already = mine.find((s) => s.endpoint === endpoint);
  if (!already) {
    // Make room before inserting so the DB-side cap trigger never trips for a normal user.
    const overflow = mine.length - (MAX_SUBSCRIPTIONS - 1);
    if (overflow > 0) {
      await sb.from("push_subscriptions").delete().in("id", mine.slice(0, overflow).map((s) => s.id));
    }
  }
  // An endpoint is unique across users: re-subscribing on a shared device moves it to the current user.
  const { error } = await sb.from("push_subscriptions").upsert(
    { user_id: authed.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: userAgent ?? null },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = z.object({ endpoint: z.string().max(1000) }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { error } = await notificationsDb()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", authed.user.id)
    .eq("endpoint", parsed.data.endpoint);
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
