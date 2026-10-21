import type { SupabaseClient } from "@supabase/supabase-js";

import { normaliseTaste, type TasteBrief } from "./brief";

/** Migration 0113 adds `taste_profiles.stated`; until it is applied every call here degrades to "unavailable". */
export type StatedResult = { status: "ok"; taste: TasteBrief | null } | { status: "unavailable" };

export async function loadStatedTaste(db: SupabaseClient, userId: string): Promise<StatedResult> {
  const { data, error } = await db.from("taste_profiles").select("stated").eq("user_id", userId).maybeSingle();
  if (error) return { status: "unavailable" };
  return { status: "ok", taste: normaliseTaste((data as { stated?: unknown } | null)?.stated) };
}

/** Upserts only the stated column, leaving derived weights alone. */
export async function saveStatedTaste(db: SupabaseClient, userId: string, taste: TasteBrief | null): Promise<"ok" | "unavailable"> {
  const { error } = await db
    .from("taste_profiles")
    .upsert({ user_id: userId, stated: taste, updated_at: new Date().toISOString() } as never, { onConflict: "user_id" });
  return error ? "unavailable" : "ok";
}
