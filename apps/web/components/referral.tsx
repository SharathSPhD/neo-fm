"use client";

import { useEffect, useState } from "react";

import { firstTouchUtm } from "./funnel-beacon";
import { REF_STORAGE_KEY, cleanRef } from "../lib/share/referral";

let handlePromise: Promise<string | null> | null = null;

/** The signed-in listener's public handle, for tagging the links they share. Null while loading, signed out or without one. */
export function useShareHandle(enabled = true): string | null {
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    handlePromise ??= fetch("/api/me/share-ref", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ handle?: unknown }>) : { handle: null }))
      .then((j) => cleanRef(j.handle))
      .catch(() => null);
    let live = true;
    void handlePromise.then((h) => live && setHandle(h));
    return () => { live = false; };
  }, [enabled]);
  return handle;
}

/** On a shared link's landing page: remember who shared it, in this browser only. The first sharer seen wins. */
export function ReferralCapture() {
  useEffect(() => {
    try {
      const ref = cleanRef(new URLSearchParams(location.search).get("ref"));
      if (ref && !localStorage.getItem(REF_STORAGE_KEY)) localStorage.setItem(REF_STORAGE_KEY, ref);
    } catch { /* storage blocked: no recognition, nothing else changes */ }
  }, []);
  return null;
}

/** In the signed-in shell: tell the server once that this new listener came from a sharer's link, then forget it. */
export function ReferralClaim() {
  useEffect(() => {
    let ref: string | null = null;
    try { ref = cleanRef(localStorage.getItem(REF_STORAGE_KEY)); } catch { return; }
    if (!ref) return;
    void fetch("/api/referral/claim", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ ref, utm: firstTouchUtm() ?? undefined }),
    }).finally(() => { try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ } });
  }, []);
  return null;
}
