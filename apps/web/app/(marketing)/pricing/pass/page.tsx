/**
 * /pricing/pass -- what the Station pass gives, a live (unsaved) preview of the language-mix picker, and the Stripe checkout.
 * Only exists while STATION_PASS_MIX=1; otherwise it is a 404 and nothing links here. The checkout button is the one the pricing
 * page uses, so in the Android/iOS app shell it turns into plain text (store rules; the checkout route also answers purchases_on_web).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FunnelBeacon } from "@/components/funnel-beacon";
import { getBillingConfigOrNull, isBillingEnabled } from "@/lib/billing/config";
import { passMonthlyTracks, readOwnStationPass } from "@/lib/billing/pass";
import { serverI18n } from "@/lib/i18n/server";
import { MAX_PASS_MOODS, passMixEnabled } from "@/lib/station/lang-mix";
import { createServerClient } from "@/lib/supabase/server";

import { UpgradeButton, UpgradeSignInLink } from "../upgrade-button";
import { PassPreview } from "./pass-preview";

export const metadata: Metadata = { alternates: { canonical: "/pricing/pass" } };
export const dynamic = "force-dynamic";

/** Must match the Stripe price created by /api/admin/stripe-setup (14900 paise), like pricing/page.tsx. */
const STATION_PASS_PRICE = "₹149";

export default async function StationPassPage() {
  if (!passMixEnabled()) notFound();
  const { t } = await serverI18n();
  const billing = isBillingEnabled() ? getBillingConfigOrNull() : null;
  let signedIn = false;
  let hasPass = false;
  if (billing?.stationPassPrice) {
    const supabase = createServerClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data?.user);
    if (data?.user) hasPass = (await readOwnStationPass(supabase, data.user.id)) !== null;
  }
  const perks = [
    t("passpage.f.mix"),
    t("passpage.f.moods", { n: MAX_PASS_MOODS }),
    t("passpage.f.ads"),
    t("passpage.f.songs", { n: passMonthlyTracks() }),
  ];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <FunnelBeacon event="pricing_view" />
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-foreground/60">{t("pricing.pass.title")}</p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{t("passpage.title")}</h1>
        <p className="text-base text-foreground/70">{t("passpage.intro")}</p>
      </header>
      <ul className="flex flex-col gap-2" data-testid="pass-perks">
        {perks.map((p) => (
          <li key={p} className="glass rounded-xl px-4 py-3 text-sm">{p}</li>
        ))}
      </ul>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("passpage.preview.title")}</h2>
        <PassPreview />
      </section>
      <section className="glass flex flex-col gap-3 rounded-2xl border-accent/30 p-6" data-testid="pass-cta">
        <span className="text-3xl font-medium">{STATION_PASS_PRICE}<span className="text-base text-foreground/60"> {t("pricing.pass.perMonth")}</span></span>
        {hasPass ? (
          <>
            <p data-testid="pass-owned" className="text-sm font-medium text-accent">{t("pricing.pass.owned")}</p>
            <a href="/account" className="inline-flex w-fit rounded-full border border-accent/40 px-5 py-2 text-sm hover:bg-accent/10">{t("pricing.pass.manage")}</a>
          </>
        ) : billing?.stationPassPrice ? (
          <>
            {signedIn ? <UpgradeButton pass="station" label={t("pricing.pass.cta")} /> : <UpgradeSignInLink label={t("pricing.pass.cta")} />}
            <p className="text-center text-xs text-foreground/50">{t("pricing.pass.note")}</p>
          </>
        ) : (
          <p className="text-sm text-foreground/70">{t("passpage.soon")}</p>
        )}
      </section>
      <a href="/pricing" className="text-sm underline">{t("passpage.all")}</a>
    </main>
  );
}
