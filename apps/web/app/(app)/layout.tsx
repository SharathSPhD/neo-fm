/**
 * Authed-app route-group layout. Redirects unauthenticated visitors to
 * `/sign-in?next=…` and wraps every page in `<AppShell>` (top nav,
 * mobile bottom nav, user menu, theme toggle).
 *
 * Sister layout: `(marketing)/layout.tsx` for public pages.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { fetchShellUser } from "@/lib/supabase/shell-user";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await fetchShellUser();
  if (!user) {
    // Preserve the path the user originally requested so the sign-in
    // form can bounce them back after a successful auth.
    const h = headers();
    const path = h.get("x-invoke-path") ?? h.get("next-url") ?? "/library";
    redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }

  // Active-nav detection happens at the page level via aria-current; the
  // shell honours an optional `active` override but defaults to none.
  return <AppShell user={user}>{children}</AppShell>;
}
