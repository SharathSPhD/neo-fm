/**
 * GET /api/notifications[?limit=20]  -> { items, unread, prefs }
 * Reads through the caller's own session, so RLS (owner-only select, migration 0085)
 * is the access control; nothing here can return another user's rows.
 */
import { NextResponse, type NextRequest } from "next/server";

import { resolvePrefs, type NotificationRow } from "../../../lib/notifications/types";
import { requireUser } from "../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;
  const sb = authed.supabase as unknown as import("@supabase/supabase-js").SupabaseClient;

  const n = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 50) : 20;

  const [list, unread, prefs] = await Promise.all([
    sb
      .from("notifications")
      .select("id, type, data, count, created_at, read_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<NotificationRow[]>(),
    sb
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
    sb.from("notification_prefs").select("prefs").eq("user_id", user.id).maybeSingle<{ prefs: unknown }>(),
  ]);

  // Before migration 0085 the tables don't exist: behave as "no notifications" rather than erroring the whole shell.
  if (list.error) {
    return NextResponse.json({ items: [], unread: 0, prefs: resolvePrefs(null) });
  }
  return NextResponse.json(
    {
      items: list.data ?? [],
      unread: unread.count ?? 0,
      prefs: resolvePrefs(prefs.data?.prefs),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
