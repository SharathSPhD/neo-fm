/**
 * POST /api/notifications/read  { ids?: uuid[] , all?: true }
 * Marks the caller's notifications read. Service-role write pinned to user_id.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { notificationsDb } from "../../../../lib/notifications/db";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
]);

export async function POST(request: NextRequest) {
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

  let q = notificationsDb()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", authed.user.id)
    .is("read_at", null);
  if ("ids" in parsed.data) q = q.in("id", parsed.data.ids);
  const { error } = await q;
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
