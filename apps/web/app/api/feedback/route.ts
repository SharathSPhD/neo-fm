/**
 * POST /api/feedback  body: { subject, body, referrer? }
 *
 * Captures user feedback via the `submit_feedback` RPC (migration
 * 0021). Anonymous-safe. Returns 200 with `{ id }` on success.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";

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
  const supabase = createServerClient();
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
  return NextResponse.json({ id: row.id });
}
