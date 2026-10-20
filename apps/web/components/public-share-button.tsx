"use client";

import { useState } from "react";

import { useShareHandle } from "@/components/referral";
import { withShareUtm } from "@/lib/share/attribution";

/**
 * Share control for a public song page: Web Share API where available,
 * copy-link otherwise. A completed share by a signed-in viewer is
 * recorded as a "share" signal (once per tab) for the weekly chart.
 */
export function PublicShareButton({
  title,
  feedbackSongId,
}: {
  title: string;
  /** Present only for signed-in viewers. */
  feedbackSongId?: string;
}) {
  const shareHandle = useShareHandle(Boolean(feedbackSongId));
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [recorded, setRecorded] = useState(false);

  function record() {
    if (!feedbackSongId || recorded) return;
    setRecorded(true);
    void fetch(`/api/songs/${encodeURIComponent(feedbackSongId)}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ kind: "share" }),
    }).catch(() => undefined);
  }

  async function onClick() {
    const clean = `${window.location.origin}${window.location.pathname}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `Listen to “${title}” on neo-fm, your personal FM`, url: withShareUtm(clean, "native", "song", shareHandle) });
        record();
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(withShareUtm(clean, "copy", "song", shareHandle));
      setState("copied");
      record();
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-muted/30 px-3 py-1.5 text-xs hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : "Share"}
    </button>
  );
}
