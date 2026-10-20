import "server-only";

import { cleanRef } from "./referral";
import { createServerClient } from "../supabase/server";

/** The signed-in viewer's public handle, so a share link they send from a server-rendered page carries it. Null for visitors. */
export async function viewerHandle(): Promise<string | null> {
  try {
    const supabase = createServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data } = await (
      supabase.from("public_profiles" as never) as unknown as {
        select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { handle: string | null } | null }> } };
      }
    )
      .select("handle")
      .eq("id", auth.user.id)
      .maybeSingle();
    return cleanRef(data?.handle);
  } catch {
    return null;
  }
}
