/**
 * POST /api/account/handle  body: { handle }
 *
 * Claims (or changes) the authed user's public handle. Delegates
 * to the `claim_handle` RPC (migration 0023) which enforces the
 * char + length rules and uniqueness.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/supabase/auth";

const BodySchema = z.object({
  handle: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/i),
});

export const dynamic = "force-dynamic";

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
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { data, error } = await supabase.rpc("claim_handle", {
    p_handle: parsed.data.handle.toLowerCase(),
  } as never);
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("handle_taken")) {
      return NextResponse.json({ error: "handle_taken" }, { status: 409 });
    }
    if (msg.includes("handle_reserved")) {
      return NextResponse.json({ error: "handle_reserved" }, { status: 400 });
    }
    if (msg.includes("handle_too_short")) {
      return NextResponse.json({ error: "handle_too_short" }, { status: 400 });
    }
    if (msg.includes("handle_too_long")) {
      return NextResponse.json({ error: "handle_too_long" }, { status: 400 });
    }
    if (msg.includes("handle_bad_chars")) {
      return NextResponse.json({ error: "handle_bad_chars" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "claim_failed", details: msg },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({ handle: row?.handle ?? parsed.data.handle });
}
