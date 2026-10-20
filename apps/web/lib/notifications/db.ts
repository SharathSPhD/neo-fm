import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "../supabase/server";

/** Untyped service client: the notification tables aren't in the generated Database type yet. */
export function notificationsDb(): SupabaseClient {
  return createServiceRoleClient() as unknown as SupabaseClient;
}
