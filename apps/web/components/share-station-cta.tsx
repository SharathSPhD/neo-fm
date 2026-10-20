import Link from "next/link";

import type { UiKey } from "@/lib/i18n/ui-strings";

/**
 * The one ask on a shared song for someone who just arrived from a link: keep listening on a free station.
 * The campaign tags on the incoming link are kept by the funnel beacon (first touch), so the station inherits them.
 */
export function ShareStationCta({ t }: { t: (key: UiKey) => string }) {
  return (
    <section aria-label={t("pub.cta.title")} className="glass flex flex-col gap-3 rounded-2xl p-5" data-testid="share-station-cta">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-medium tracking-tight">{t("pub.cta.title")}</p>
        <p className="text-sm text-foreground/70">{t("pub.cta.body")}</p>
      </div>
      <Link
        href="/station"
        className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-background shadow-[0_0_24px_-6px_hsl(var(--accent))] transition hover:bg-accent/90 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {t("pub.cta.button")}
      </Link>
    </section>
  );
}
