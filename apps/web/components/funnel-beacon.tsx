"use client";

import { useEffect } from "react";

import type { FunnelEvent } from "../lib/ops/funnel";

/** Counts one anonymous page view (see /api/events). No cookies or identifiers; honours DNT and GPC client-side too. */
export function FunnelBeacon({ event }: { event: FunnelEvent }) {
  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    try {
      // Once per tab per page so refreshes do not inflate the count.
      const key = `fb:${event}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: count it anyway */ }
    void fetch("/api/events", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }), keepalive: true,
    }).catch(() => undefined);
  }, [event]);
  return null;
}
