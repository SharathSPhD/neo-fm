/**
 * PUT /api/notifications/prefs  { [type]: { in_app?, push? } }  -> resolved prefs
 * Partial update; unknown types and keys are rejected. takedown and song_failed stay on in-app.
 */
import { NextResponse, type NextRequest } from "next/server";

import { notificationsDb } from "../../../../lib/notifications/db";
import { applyPrefsPatch, PrefsPatchSchema, resolvePrefs } from "../../../../lib/notifications/types";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PrefsPatchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const sb = notificationsDb();
  const { data: cur } = await sb
    .from("notification_prefs")
    .select("prefs")
    .eq("user_id", authed.user.id)
    .maybeSingle<{ prefs: unknown }>();
  const next = applyPrefsPatch(cur?.prefs, parsed.data);
  const { error } = await sb
    .from("notification_prefs")
    .upsert({ user_id: authed.user.id, prefs: next, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  return NextResponse.json({ prefs: resolvePrefs(next) });
}
