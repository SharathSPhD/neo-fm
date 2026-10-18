import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationType } from "./types";

/**
 * Creates a notification through the service-role-only notify_user() SQL
 * function, which applies the user's preferences, folds repeats and marks
 * the row for push. Best effort: a notification problem must never fail the
 * action that caused it, and before migration 0085 is applied this is a no-op.
 */
export async function notifyUser(
  db: SupabaseClient,
  userId: string,
  type: NotificationType,
  data: Record<string, unknown>,
  dedupeKey?: string,
): Promise<void> {
  try {
    await db.rpc("notify_user", {
      p_user: userId,
      p_type: type,
      p_data: data,
      p_dedupe_key: dedupeKey ?? null,
    });
  } catch (e) {
    console.warn("[notifications] notify failed", e instanceof Error ? e.message : e);
  }
}
