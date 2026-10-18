"use client";

import { useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

/** Web Share API where available, copy-link fallback everywhere else. */
export function ShareProfileButton({ handle, text }: { handle: string; text: string }) {
  const { t } = useUiLang();
  const [note, setNote] = useState<string | null>(null);

  async function share() {
    const url = `${window.location.origin}/u/${handle}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `@${handle} on neo-fm`, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote(t("profile.linkCopied"));
    } catch (err) {
      // The user closing the share sheet is not an error.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNote(t("profile.shareFailed"));
    }
    setTimeout(() => setNote(null), 2500);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        className="rounded-md border border-muted/40 px-3 py-1.5 text-sm text-foreground/80 hover:border-accent/50 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {t("profile.shareProfile")}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-foreground/60">
        {note}
      </span>
    </span>
  );
}
