"use client";

import { useEffect } from "react";

import type { FunnelEvent } from "../lib/ops/funnel";

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
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }), keepalive: true,
  }).catch(() => undefined);
}

/** Counts one anonymous page view per tab. */
export function FunnelBeacon({ event }: { event: FunnelEvent }) {
  useEffect(() => { sendFunnelEvent(event, { once: true }); }, [event]);
  return null;
}
