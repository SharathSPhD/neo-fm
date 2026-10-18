/**
 * POST /api/feedback  body: { subject, body, referrer? }
 *
 * Captures user feedback via the `submit_feedback` RPC (migration
 * 0021). Anonymous-safe. Returns 200 with `{ id }` on success.
 *
 * The RPC is called with the service role: migration 0101 revokes EXECUTE from anon/authenticated so it cannot be
 * hit directly over /rest/v1/rpc (bypassing the per-IP limiter in middleware). The role grant exists before and
 * after 0101, so this works either way. auth.uid() is null under the service role, so the signed-in user is
 * attached afterwards.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  referrer: z.string().max(500).nullish(),
});

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { data: auth } = await createServerClient().auth.getUser();
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("submit_feedback", {
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
    p_referrer: parsed.data.referrer ?? null,
  } as never);
  if (error) {
    return NextResponse.json(
      { error: "submit_feedback_failed", details: error.message },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.id) {
    return NextResponse.json(
      { error: "submit_feedback_failed" },
      { status: 500 },
    );
  }
  if (auth?.user) {
    await supabase.from("feedback").update({ user_id: auth.user.id }).eq("id", row.id);
  }
  return NextResponse.json({ id: row.id });
}
