"use client";

/**
 * Subscribes to Supabase's browser auth state and refreshes the RSC
 * tree when sign-in / sign-out happens in another tab (or via the
 * `/auth/callback` route). Without this listener, a freshly-signed-in
 * user can land on `/library` only to see the marketing nav until they
 * hit refresh.
 *
 * The listener is mounted by the root layout so it covers every route
 * group. It does not render anything. The Supabase client is imported
 * lazily after the page is idle so it stays out of the critical path (it
 * was the largest chunk on the landing page's main thread).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AuthListener() {
  const router = useRouter();
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const start = async () => {
      const { createBrowserSupabase } = await import("@/lib/supabase/client");
      if (cancelled) return;
      const supabase = createBrowserSupabase();
      const { data: sub } = supabase.auth.onAuthStateChange((event, _session) => {
        if (
          event === "SIGNED_IN" ||
          event === "SIGNED_OUT" ||
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED"
        ) {
          // refresh re-runs server components with the new cookie state
          router.refresh();
        }
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    };
    let began = false;
    const begin = () => {
      if (began) return;
      began = true;
      void start();
    };
    // Signed-in visitors (a Supabase auth cookie) subscribe once the page is idle. Signed-out visitors have nothing to
    // react to until they act, so the auth client waits for their first interaction (or a long fallback) and stays out
    // of the landing page's load.
    const signedIn = /(?:^|;\s*)sb-[^=]*auth-token/.test(document.cookie);
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const timer = signedIn
      ? idle
        ? idle(begin, { timeout: 4000 })
        : window.setTimeout(begin, 2000)
      : window.setTimeout(begin, 20_000);
    if (!signedIn) for (const e of events) window.addEventListener(e, begin, { once: true, passive: true });
    return () => {
      cancelled = true;
      if (signedIn && idle) (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(timer);
      else window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, begin);
      unsubscribe?.();
    };
  }, [router]);
  return null;
}
