/**
 * POST /api/songs/[id]/favorite
 *
 * Toggles `jobs.is_favorite` for the authenticated user. RLS on the
 * underlying table enforces ownership; the `toggle_favorite` RPC
 * (migration 0022) is SECURITY INVOKER so we still go through RLS.
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

  const { data, error } = await supabase.rpc("toggle_favorite", {
    p_job_id: params.id,
  } as never);
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "toggle_failed", details: error.message },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({
    id: params.id,
    is_favorite: !!row?.is_favorite,
  });
}
