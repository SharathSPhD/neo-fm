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

/** Saved taste for many listeners in one read; an unavailable table (migration 0113 not applied) reads as nobody. */
export async function loadStatedTasteMany(db: SupabaseClient, userIds: string[]): Promise<Map<string, TasteBrief>> {
  const out = new Map<string, TasteBrief>();
  if (!userIds.length) return out;
  const { data, error } = await db.from("taste_profiles").select("user_id, stated").in("user_id", userIds);
  if (error) return out;
  for (const r of (data ?? []) as { user_id: string; stated?: unknown }[]) {
    const t = normaliseTaste(r.stated);
    if (t) out.set(r.user_id, t);
  }
  return out;
}
