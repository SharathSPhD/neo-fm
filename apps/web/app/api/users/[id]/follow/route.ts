/**
 * POST /api/users/[id]/follow
 *
 * Toggles a follow relationship between the authed user and the
 * target. Delegates to the `toggle_follow` RPC (migration 0024).
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { data, error } = await supabase.rpc("toggle_follow", {
    p_followee: params.id,
  } as never);
  if (error) {
    if (error.message?.includes("cannot_follow_self")) {
      return NextResponse.json({ error: "cannot_follow_self" }, { status: 400 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "follow_failed", details: error.message },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({
    is_following: !!row?.is_following,
    follower_count: row?.follower_count ?? 0,
  });
}
