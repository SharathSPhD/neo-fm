/**
 * /api/me/taste -- the listener's own taste profile (opt-in personalization).
 *   GET    -> { consent, card, profile }       (profile is computed from the caller's own feedback; nothing hidden)
 *   POST   { consent: boolean }                grants/withdraws the 'personalize' consent
 *   DELETE -> forget me: withdraws consent and deletes the caller's feedback events and stored profile
 * RLS pins every read/write to the caller; no service role here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { hasPersonalizationConsent, loadTaste } from "../../../../lib/personalization/load";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";
const CONSENT_VERSION = "2026-10";

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;
  const consent = await hasPersonalizationConsent(supabase as never, user.id);
  if (!consent) return NextResponse.json({ consent: false, card: "", profile: null });
  const { profile, card } = await loadTaste(supabase as never, user.id);
  return NextResponse.json({ consent: true, card, profile });
}

export async function POST(req: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const body = z.object({ consent: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { supabase, user } = authed;
  const { error } = await (supabase.from("consents" as never) as never as { upsert: (v: unknown, o: unknown) => Promise<{ error: unknown }> }).upsert(
    { user_id: user.id, purpose: "personalize", version: CONSENT_VERSION, granted_at: new Date().toISOString(), withdrawn_at: body.data.consent ? null : new Date().toISOString() },
    { onConflict: "user_id,purpose" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ consent: body.data.consent });
}

export async function DELETE() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;
  await supabase.from("feedback_events" as never).delete().eq("user_id" as never, user.id as never);
  await supabase.from("taste_profiles" as never).delete().eq("user_id" as never, user.id as never);
  await (supabase.from("consents" as never) as never as { upsert: (v: unknown, o: unknown) => Promise<unknown> }).upsert(
    { user_id: user.id, purpose: "personalize", version: CONSENT_VERSION, withdrawn_at: new Date().toISOString() },
    { onConflict: "user_id,purpose" },
  );
  return NextResponse.json({ ok: true });
}
