import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  const { user, supabase } = authed;
  const { data, error } = await supabase
    .from("users")
    .select("id, email, name, locale, tier")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
