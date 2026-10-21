/**
 * /api/me/taste/stated -- the listener's saved taste brief (TASTE_BRIEF=1), the cold-start input for per-user tuning.
 *   GET    -> { taste }                    404 when the flag is off; { taste: null, available: false } before migration 0113
 *   PUT    { taste }                       needs the 'personalize' consent (403 consent_required otherwise); 503 before 0113
 *   DELETE -> clears the saved brief
 * Reads use the caller's session (RLS); the write goes through the service role pinned to the caller's id, because
 * clients have no INSERT/UPDATE grant on taste_profiles.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { screenRequest } from "../../../../../lib/safety";
import { hasPersonalizationConsent } from "../../../../../lib/personalization/load";
import { requireUser } from "../../../../../lib/supabase/auth";
import { createServiceRoleClient } from "../../../../../lib/supabase/server";
import { TasteBriefSchema, normaliseTaste, tasteBriefEnabled, tasteScreenText } from "../../../../../lib/taste/brief";
import { loadStatedTaste, saveStatedTaste } from "../../../../../lib/taste/store";

export const dynamic = "force-dynamic";

const off = () => NextResponse.json({ error: "not_found" }, { status: 404 });

export async function GET() {
  if (!tasteBriefEnabled()) return off();
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const r = await loadStatedTaste(authed.supabase as never, authed.user.id);
  return NextResponse.json(r.status === "ok" ? { taste: r.taste } : { taste: null, available: false });
}

export async function PUT(req: NextRequest) {
  if (!tasteBriefEnabled()) return off();
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const body = z.object({ taste: TasteBriefSchema }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const taste = normaliseTaste(body.data.taste);
  if (!taste) return NextResponse.json({ error: "empty_taste" }, { status: 400 });
  if (!(await hasPersonalizationConsent(authed.supabase as never, authed.user.id))) {
    return NextResponse.json({ error: "consent_required" }, { status: 403 });
  }
  const text = tasteScreenText(taste);
  const verdict = text ? await screenRequest(text, "brief") : null;
  if (verdict && !verdict.allowed) {
    return NextResponse.json({ error: "content_policy", category: verdict.category, message: verdict.reason }, { status: verdict.category === "moderation_unavailable" ? 503 : 422 });
  }
  const saved = await saveStatedTaste(createServiceRoleClient() as never, authed.user.id, taste);
  return saved === "ok" ? NextResponse.json({ taste }) : NextResponse.json({ error: "unavailable" }, { status: 503 });
}

export async function DELETE() {
  if (!tasteBriefEnabled()) return off();
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const saved = await saveStatedTaste(createServiceRoleClient() as never, authed.user.id, null);
  return saved === "ok" ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "unavailable" }, { status: 503 });
}
