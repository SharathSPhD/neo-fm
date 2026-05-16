/**
 * POST /api/songs/[id]/like
 *
 * Toggles a like on a published song. Anonymous likes are not
 * supported in v1.1 -- the RPC raises 'unauthenticated' which we
 * surface as 401 so the client can redirect to /sign-in.
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

  const { data, error } = await supabase.rpc("toggle_like", {
    p_job_id: params.id,
  } as never);
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "like_failed", details: error.message },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({
    is_liked: !!row?.is_liked,
    like_count: row?.like_count ?? 0,
  });
}
