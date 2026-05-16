/**
 * Server-side helper used by `(app)/layout.tsx` to assemble the props
 * the `<AppShell>` wants (email, optional handle, plan label).
 *
 * `handle` is read from `public.users.handle` (Sprint G migration 0023
 * adds the column). For now the query tolerates the column being
 * absent and returns `null`; the user menu falls back to email + the
 * "Pick a handle" CTA.
 */
import "server-only";

import { createServerClient } from "./server";

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  creator: "Creator",
  pro: "Pro",
};

export async function fetchShellUser() {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  // Tolerant select: requests both `tier` and `handle`. The `handle`
  // column is added in Sprint G migration 0023. Until then PostgREST
  // 400s; we catch and re-select without it. (The generated
  // `Database` type doesn't know about `handle` yet, hence the cast.)
  let row: { tier?: string | null; handle?: string | null } | null = null;
  const withHandle = await (
    supabase.from("users") as unknown as {
      select: (s: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          maybeSingle: () => Promise<{
            data: { tier?: string | null; handle?: string | null } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .select("tier, handle")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (withHandle.error) {
    const plain = await supabase
      .from("users")
      .select("tier")
      .eq("id", auth.user.id)
      .maybeSingle();
    row = plain.data ?? null;
  } else {
    row = withHandle.data ?? null;
  }

  return {
    id: auth.user.id,
    email: auth.user.email ?? "",
    handle: (row?.handle as string | null | undefined) ?? null,
    plan: PLAN_LABEL[row?.tier ?? "free"] ?? "Free",
  };
}
