/**
 * PUT /api/songs/[id]/dedication  body { to, message }  -> set or clear
 * Owner-only (enforced again inside the set_dedication RPC). Both fields
 * are screened by the same moderation as briefs because they appear on a
 * public page and card; if moderation is unavailable we fail closed.
 */
import { NextResponse, type NextRequest } from "next/server";

import { SongIdSchema } from "../../../../../lib/api/song-schemas";
import { screenRequest } from "../../../../../lib/safety";
import { DedicationBodySchema } from "../../../../../lib/share/dedication";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const idCheck = SongIdSchema.safeParse(params.id);
  if (!idCheck.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = DedicationBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { to, message } = parsed.data;

  if (to || message) {
    const verdict = await screenRequest(
      [to, message].filter(Boolean).join("\n"),
      "brief",
    );
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "content_blocked", reason: verdict.reason },
        { status: 422 },
      );
    }
  }

  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { code?: string } | null }>
  )("set_dedication", {
    p_job_id: idCheck.data,
    p_to: to,
    p_message: message,
  });
  if (error) {
    const code = error.code;
    if (code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (code === "P0002") return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  return NextResponse.json({ to, message });
}
