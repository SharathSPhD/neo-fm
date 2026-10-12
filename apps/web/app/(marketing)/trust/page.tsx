/**
 * /trust -- public responsible-AI commitments. Every claim here maps to code
 * or a documented vendor behaviour; if the product changes, change this page.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { serverI18n } from "@/lib/i18n/server";
import type { UiKey } from "@/lib/i18n/ui-strings";

export const metadata: Metadata = {
  alternates: { canonical: "/trust" },
  title: "Trust & safety -- neo-fm",
  description:
    "How neo-fm keeps AI music honest: original lyrics, no voice cloning, labelled AI audio, fail-closed safety checks and clear privacy limits.",
};

const COMMITMENTS: readonly { title: UiKey; body: UiKey }[] = [
  { title: "trust.c1.title", body: "trust.c1.body" },
  { title: "trust.c2.title", body: "trust.c2.body" },
  { title: "trust.c3.title", body: "trust.c3.body" },
  { title: "trust.c4.title", body: "trust.c4.body" },
  { title: "trust.c5.title", body: "trust.c5.body" },
  { title: "trust.c6.title", body: "trust.c6.body" },
];

export default async function TrustPage() {
  const { t } = await serverI18n();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t("trust.title")}</h1>
      <p className="mt-3 text-foreground/70">
        {t("trust.intro")}
      </p>
      <ul className="mt-10 space-y-8">
        {COMMITMENTS.map((c) => (
          <li key={c.title}>
            <h2 className="text-lg font-medium">{t(c.title)}</h2>
            <p className="mt-1 text-foreground/70">{t(c.body)}</p>
          </li>
        ))}
      </ul>
      <section className="mt-12 rounded-lg border border-muted/30 p-5" aria-labelledby="grievance-heading">
        <h2 id="grievance-heading" className="text-lg font-medium">{t("trust.g.title")}</h2>
        <p className="mt-2 text-sm text-foreground/70">
          {t("trust.g.p1a")} <strong>{t("pub.report.open")}</strong> {t("trust.g.p1b")}{" "}
          <a className="underline" href="mailto:grievance@neo-fm.com">grievance@neo-fm.com</a> {t("trust.g.p1c")}
        </p>
        <p className="mt-2 text-sm text-foreground/60">
          {t("trust.g.notReport")}{" "}
          <Link href="/feedback" className="underline">{t("trust.g.feedback")}</Link>.
        </p>
      </section>
    </main>
  );
}
