/**
 * /pricing -- public tier comparison + tier CTAs.
 *
 * Sprint E (v1.1) shipped this page with waitlist-only CTAs.
 * Sprint 5b (v1.2) layers real Stripe Checkout on top:
 *
 *   - if billing env is fully configured AND the visitor is signed in,
 *     Creator/Pro render an Upgrade button that POSTs to
 *     /api/billing/checkout and forwards to Stripe Checkout.
 *   - otherwise we keep the original waitlist CTA so v1.1 behaviour is
 *     untouched. This matters because we run in "dummy" mode whenever
 *     the operator hasn't filled in the Stripe env yet.
 *
 * The Free CTA is unchanged.
 */
import type { Metadata } from "next";

import { FunnelBeacon } from "@/components/funnel-beacon";
import { isBillingEnabled } from "@/lib/billing/config";
import { serverI18n } from "@/lib/i18n/server";
import type { UiKey } from "@/lib/i18n/ui-strings";
import { createServerClient } from "@/lib/supabase/server";

import { UpgradeButton } from "./upgrade-button";
import { WaitlistButton } from "./waitlist-button";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing -- neo-fm",
  description:
    "Free for 3 songs a month. Creator (₹299) and Pro (₹799) add more songs, longer tracks, Pro-grade lyric polish and pronunciation checks. Cancel anytime.",
};

interface Tier {
  id: "free" | "creator" | "pro";
  label: string;
  price: string;
  pitch: UiKey;
  features: readonly UiKey[];
  cta:
    | { kind: "primary"; href: string; label: UiKey }
    | { kind: "waitlist"; tier: "creator" | "pro"; label: UiKey };
}

// Copy lives in lib/i18n/locales; plan names and prices are not translated.
const TIERS: readonly Tier[] = [
  {
    id: "free",
    label: "Free",
    price: "₹0",
    pitch: "pricing.free.pitch",
    features: [
      "pricing.free.f1",
      "pricing.free.f2",
      "pricing.free.f3",
      "pricing.free.f4",
      "pricing.free.f5",
    ],
    cta: { kind: "primary", href: "/sign-up", label: "pricing.free.cta" },
  },
  {
    id: "creator",
    label: "Creator",
    price: "₹299",
    pitch: "pricing.creator.pitch",
    features: [
      "pricing.creator.f1",
      "pricing.creator.f2",
      "pricing.creator.f3",
      "pricing.creator.f4",
      "pricing.creator.f5",
    ],
    cta: { kind: "waitlist", tier: "creator", label: "pricing.creator.cta" },
  },
  {
    id: "pro",
    label: "Pro",
    price: "₹799",
    pitch: "pricing.pro.pitch",
    features: [
      "pricing.pro.f1",
      "pricing.pro.f2",
      "pricing.pro.f3",
      "pricing.pro.f4",
      "pricing.pro.f5",
    ],
    cta: { kind: "waitlist", tier: "pro", label: "pricing.pro.cta" },
  },
];

export default async function PricingPage() {
  const { t } = await serverI18n();
  // Server-side check so we don't bundle the Stripe client when billing
  // is off. `isBillingEnabled()` is also called inside /api/billing/*
  // so dummy mode always returns 503, never an undefined-key crash.
  const billingEnabled = isBillingEnabled();
  let signedIn = false;
  if (billingEnabled) {
    const supabase = createServerClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data?.user);
  }
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12">
      <FunnelBeacon event="pricing_view" />
      <header className="flex flex-col gap-3 text-center">
        <p className="text-xs uppercase tracking-widest text-foreground/60">
          {t("pricing.eyebrow")}
        </p>
        <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">
          {t("pricing.headline1")}
          <br className="hidden sm:block" /> {t("pricing.headline2")}
        </h1>
        <p className="mx-auto max-w-2xl text-base text-foreground/60">
          {billingEnabled
            ? t("pricing.introLive")
            : t("pricing.introWaitlist")}
        </p>
      </header>
      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <article
            key={tier.id}
            className={`flex flex-col gap-5 rounded-xl border p-7 transition ${
              tier.id === "creator"
                ? "border-accent/40 bg-accent/5 shadow-lg shadow-accent/10"
                : "border-muted/30 bg-muted/5 hover:border-muted/50"
            }`}
          >
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-medium tracking-tight">{tier.label}</h2>
              {tier.id === "creator" ? (
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-accent">
                  {t("pricing.popular")}
                </span>
              ) : null}
            </header>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-medium">{tier.price}</span>
              <span className="text-sm text-foreground/50">{t("pricing.perMonth")}</span>
            </div>
            <p className="text-sm text-foreground/70">{t(tier.pitch)}</p>
            <ul className="flex flex-col gap-2 text-sm text-foreground/80">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-1 text-accent">
                    ◆
                  </span>
                  <span>{t(f)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-2">
              {tier.cta.kind === "primary" ? (
                <a
                  href={tier.cta.href}
                  className="block w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20"
                >
                  {t(tier.cta.label)}
                </a>
              ) : billingEnabled && signedIn ? (
                <UpgradeButton
                  tier={tier.cta.tier}
                  label={t("pricing.upgradeTo", { tier: tier.label })}
                />
              ) : billingEnabled ? (
                <a
                  href={`/sign-in?next=${encodeURIComponent("/pricing")}`}
                  className="block w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20"
                >
                  {t("pricing.upgradeTo", { tier: tier.label })}
                </a>
              ) : (
                <WaitlistButton tier={tier.cta.tier} label={t(tier.cta.label)} />
              )}
            </div>
          </article>
        ))}
      </section>
      <footer className="mx-auto max-w-2xl rounded-md border border-muted/20 bg-muted/5 px-6 py-4 text-center text-xs text-foreground/50">
        {t("pricing.footnote")} <a href="/help" className="underline">{t("pricing.faq")}</a>.
      </footer>
    </main>
  );
}
