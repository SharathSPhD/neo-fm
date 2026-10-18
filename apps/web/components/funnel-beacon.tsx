"use client";

import { useEffect } from "react";

import type { FunnelEvent } from "../lib/ops/funnel";
import { cleanUtm, utmFromSearch, type Utm } from "../lib/ops/utm";

const UTM_KEY = "fb:utm";

/** The campaign that first brought this browser here. Kept in this browser only; the first one seen wins. */
export function firstTouchUtm(): Utm | null {
  try {
    const saved = cleanUtm(JSON.parse(localStorage.getItem(UTM_KEY) ?? "null"));
    if (saved) return saved;
    const fresh = utmFromSearch(location.search);
    if (fresh) localStorage.setItem(UTM_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return utmFromSearch(location.search);
  }
}

/**
 * Counts one anonymous event (see /api/events). No cookies or identifiers; honours DNT and GPC client-side too.
 * With `once`, a tab counts the event a single time so refreshes do not inflate it.
 */
export function sendFunnelEvent(event: FunnelEvent, opts: { once?: boolean } = {}): void {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
  if (opts.once) {
    try {
      const key = `fb:${event}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: count it anyway */ }
  }
  void fetch("/api/events", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event, utm: firstTouchUtm() ?? undefined }), keepalive: true,
  }).catch(() => undefined);
}

/** Counts one anonymous page view per tab. */
export function FunnelBeacon({ event }: { event: FunnelEvent }) {
  useEffect(() => { sendFunnelEvent(event, { once: true }); }, [event]);
  return null;
}
