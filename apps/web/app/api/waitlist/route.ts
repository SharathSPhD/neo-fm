/**
 * POST /api/waitlist  body: { email, tier, source? }
 *
 * Captures a paid-tier waitlist signup via the `join_waitlist` RPC
 * (migration 0019). Idempotent on (lower(email), tier). Returns
 * 200 with `{ joined: boolean, already_on_list: boolean }`.
 *
 * Open to both anon and authenticated. The IP rate limiter applied
 * by `middleware.ts` (Sprint I) covers abuse; this endpoint itself
 * is intentionally simple.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(320),
  tier: z.enum(["creator", "pro", "team"]),
  source: z.string().max(48).optional(),
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
  const { email, tier, source } = parsed.data;

  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("join_waitlist", {
    p_email: email,
    p_tier: tier,
    p_source: source ?? "pricing",
  } as never);
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("invalid_email")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (msg.includes("invalid_tier")) {
      return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "join_waitlist_failed", details: msg },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({
    joined: Boolean(row?.joined),
    already_on_list: Boolean(row?.already_on_list),
  });
}
