/** GET /api/me/share-ref -> {handle} : the signed-in listener's public handle, to tag the links they share. Null without one. */
import { NextResponse } from "next/server";

import { cleanRef } from "../../../../lib/share/referral";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { data } = await (
    authed.supabase.from("public_profiles" as never) as unknown as {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { handle: string | null } | null }> } };
    }
  )
    .select("handle")
    .eq("id", authed.user.id)
    .maybeSingle();
  return NextResponse.json({ handle: cleanRef(data?.handle) });
}
