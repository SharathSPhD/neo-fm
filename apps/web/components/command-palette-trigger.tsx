"use client";

/**
 * Discoverable pill that lives in the desktop top-nav and tells the user the
 * command palette exists. Clicking it dispatches the same synthetic
 * ⌘K / Ctrl+K event the global listener watches for, so we don't have to
 * thread state through context.
 */
import { useEffect, useMemo, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function CommandPaletteTrigger() {
  const { t } = useUiLang();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPod|iPad/i.test(window.navigator.userAgent));
  }, []);

  const label = useMemo(() => (isMac ? "⌘K" : "Ctrl K"), [isMac]);

  return (
    <button
      type="button"
      aria-label={`${t("palette.open")} (${label})`}
      onClick={() => {
        const e = new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: !isMac,
          metaKey: isMac,
          bubbles: true,
        });
        document.dispatchEvent(e);
      }}
      className="hidden h-9 items-center gap-2 rounded-md border border-muted/40 bg-background/50 px-3 text-xs font-medium text-foreground/60 transition hover:border-accent/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
    >
      <span aria-hidden>⌕</span>
      <span>{t("palette.search")}</span>
      <kbd className="rounded border border-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-foreground/55">
        {label}
      </kbd>
    </button>
  );
}
