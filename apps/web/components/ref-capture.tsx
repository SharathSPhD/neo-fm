"use client";

import { useEffect } from "react";

import { cleanRef, REF_COOKIE, REF_COOKIE_MAX_AGE } from "../lib/referral/code";

/**
 * Remembers ?ref=<code> from a shared link in a first-party cookie so the sign-up callback can credit the sender.
 * The code is a random share token, not a person; the first one seen wins. Honours DNT and GPC like the funnel beacon.
 */
export function RefCapture() {
  useEffect(() => {
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
      const code = cleanRef(new URLSearchParams(location.search).get("ref"));
      if (!code || document.cookie.split("; ").some((c) => c.startsWith(`${REF_COOKIE}=`))) return;
      document.cookie = `${REF_COOKIE}=${code}; Max-Age=${REF_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch { /* cookies blocked: no referral credit, nothing else changes */ }
  }, []);
  return null;
}
