/**
 * v1.4 Sprint 4 — DELETE /api/user-presets/[id]
 *
 * Delegates to the `delete_user_preset` SECURITY DEFINER RPC so the
 * function itself enforces ownership (RLS would too, but the RPC's
 * explicit `forbidden` vs `not_found` distinction maps cleanly to
 * HTTP 403 / 404).
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { error } = await supabase.rpc("delete_user_preset", {
    p_preset_id: params.id,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error.code === "42704") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "delete_failed", details: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ id: params.id, deleted: true });
}
