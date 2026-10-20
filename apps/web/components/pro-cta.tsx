"use client";

import Link from "next/link";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

/**
 * Upgrade nudge shown wherever a visitor has just heard a free 30-second clip.
 * Copy only claims what the Pro plan actually does (multi-pass lyric writing, full-length render).
 */
export function ProCta({ compact = false }: { compact?: boolean }) {
  const { t } = useUiLang();
  return (
    <aside
      aria-label={t("cta.ariaLabel")}
      className={`rounded-xl border border-accent/40 bg-accent/5 ${compact ? "px-4 py-3" : "p-6"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <p className={`${compact ? "text-sm" : "text-base"} font-medium`}>
            {t("cta.title")}
          </p>
          <p className="mt-1 text-sm text-foreground/70">
            {t("cta.body")}
          </p>
        </div>
        <Link
          href="/pricing"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:opacity-90 focus:outline-hidden focus:ring-2 focus:ring-accent"
        >
          {t("cta.button")}
        </Link>
      </div>
    </aside>
  );
}
