/**
 * PATCH /api/account/profile  body: { bio: string }
 *
 * Sets or clears the authed user's public bio. Length-capped, link-free and moderated. The write
 * goes through the service client because `authenticated` has no UPDATE grant on users.bio
 * (migration for bio/avatar): a direct PATCH from the browser would skip moderation.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { normalizeBio } from "@/lib/profile/bio";
import { screenRequest } from "@/lib/safety";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const BodySchema = z.object({ bio: z.string().max(2000) });

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const result = normalizeBio(parsed.data.bio);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (result.bio) {
    const verdict = await screenRequest(result.bio, "brief");
    if (!verdict.allowed) {
      const unavailable = verdict.category === "moderation_unavailable";
      return NextResponse.json(
        { error: unavailable ? "moderation_unavailable" : "bio_rejected", reason: verdict.reason },
        { status: unavailable ? 503 : 422 },
      );
    }
  }

  const db = createServiceRoleClient();
  const { error } = await db
    .from("users")
    .update({ bio: result.bio } as never)
    .eq("id", authed.user.id);
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ bio: result.bio });
}
