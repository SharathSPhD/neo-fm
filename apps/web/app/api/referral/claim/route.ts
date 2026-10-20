/**
 * POST /api/referral/claim {"ref":"<handle>"} -- records that this new listener arrived from a sharer's link (migration 0111).
 * Recognition only: no credit is granted. Always answers 204 so a missing table, an unknown handle or a repeat never shows
 * in the browser. The first claim wins; only accounts created in the last 7 days can claim, and nobody can claim themselves.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { cleanUtm } from "../../../../lib/ops/utm";
import { cleanRef } from "../../../../lib/share/referral";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const NEW_ACCOUNT_DAYS = 7;

type Db = {
  from: (t: string) => {
    select: (c: string) => { ilike: (k: string, v: string) => { limit: (n: number) => Promise<{ data: { id: string; handle: string | null }[] | null }> } };
    upsert: (row: Record<string, string>, o: { onConflict: string; ignoreDuplicates: boolean }) => Promise<unknown>;
  };
};

export async function POST(req: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let body: { ref?: unknown; utm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const handle = cleanRef(body.ref);
  if (!handle) return new NextResponse(null, { status: 204 });
  const createdAt = Date.parse(authed.user.created_at ?? "");
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > NEW_ACCOUNT_DAYS * 86_400_000) return new NextResponse(null, { status: 204 });

  try {
    const db = serviceClient() as unknown as Db;
    // "_" is a one-character wildcard in ilike, so fetch the few possible matches and compare the handle exactly.
    const { data } = await db.from("public_profiles").select("id,handle").ilike("handle", handle).limit(5);
    const sharer = (data ?? []).find((r) => r.handle?.toLowerCase() === handle);
    if (!sharer || sharer.id === authed.user.id) return new NextResponse(null, { status: 204 });
    const source = cleanUtm(body.utm)?.source ?? "";
    await db.from("referrals").upsert({ referee_id: authed.user.id, referrer_id: sharer.id, source }, { onConflict: "referee_id", ignoreDuplicates: true });
  } catch {
    /* table not applied or a hiccup: recognition is best effort */
  }
  return new NextResponse(null, { status: 204 });
}
