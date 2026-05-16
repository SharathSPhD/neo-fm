"use client";

/**
 * Subscribes to Supabase's browser auth state and refreshes the RSC
 * tree when sign-in / sign-out happens in another tab (or via the
 * `/auth/callback` route). Without this listener, a freshly-signed-in
 * user can land on `/library` only to see the marketing nav until they
 * hit refresh.
 *
 * The listener is mounted by the root layout so it covers every route
 * group. It does not render anything.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabase } from "@/lib/supabase/client";

export function AuthListener() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event, _session) => {
        if (
          event === "SIGNED_IN" ||
          event === "SIGNED_OUT" ||
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED"
        ) {
          // refresh re-runs server components with the new cookie state
          router.refresh();
        }
      },
    );
    return () => sub.subscription.unsubscribe();
  }, [router]);
  return null;
}
