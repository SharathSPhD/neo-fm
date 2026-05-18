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

import { isBillingEnabled } from "@/lib/billing/config";
import { createServerClient } from "@/lib/supabase/server";

import { UpgradeButton } from "./upgrade-button";
import { WaitlistButton } from "./waitlist-button";

export const metadata: Metadata = {
  title: "Pricing -- neo-fm",
  description:
    "Free for 3 songs a month. Creator and Pro tiers unlock longer songs, faster generations, and stem downloads. Join the waitlist while we finish billing.",
};

interface Tier {
  id: "free" | "creator" | "pro";
  label: string;
  price: string;
  cadence: string;
  pitch: string;
  features: readonly string[];
  cta:
    | { kind: "primary"; href: string; label: string }
    | { kind: "waitlist"; tier: "creator" | "pro"; label: string };
}

const TIERS: readonly Tier[] = [
  {
    id: "free",
    label: "Free",
    price: "₹0",
    cadence: "per month",
    pitch: "Try the engine. 3 songs a month, 90 seconds each.",
    features: [
      "3 songs per month (UTC)",
      "Up to 90 second songs",
      "Carnatic, Hindustani, Kannada folk, Western styles",
      "Hindi / Kannada / English / Hinglish lyrics",
      "Private library + public share links",
    ],
    cta: { kind: "primary", href: "/sign-up", label: "Start free" },
  },
  {
    id: "creator",
    label: "Creator",
    price: "₹399",
    cadence: "per month",
    pitch: "For songwriters and bedroom producers shipping demos.",
    features: [
      "25 songs per month",
      "Up to 3 minute songs",
      "Priority queue (skip the line)",
      "Stem downloads (vocal, melody, percussion)",
      "Lyrical karaoke video export",
    ],
    cta: {
      kind: "waitlist",
      tier: "creator",
      label: "Join Creator waitlist",
    },
  },
  {
    id: "pro",
    label: "Pro",
    price: "₹1,499",
    cadence: "per month",
    pitch:
      "For studios and content houses generating at scale. Bring your own raga.",
    features: [
      "200 songs per month",
      "Up to 10 minute songs",
      "Custom raga + tala uploads",
      "API access (early)",
      "Email support + SLA",
    ],
    cta: { kind: "waitlist", tier: "pro", label: "Join Pro waitlist" },
  },
];

export default async function PricingPage() {
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
      <header className="flex flex-col gap-3 text-center">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          pricing
        </p>
        <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">
          Sing your stories.
          <br className="hidden sm:block" /> Pay only when you scale.
        </h1>
        <p className="mx-auto max-w-2xl text-base text-foreground/60">
          {billingEnabled
            ? "Free covers the casual creator. Creator and Pro unlock longer songs, priority queue, stem downloads, and API access. Upgrade anytime — cancel anytime."
            : "Free covers the casual creator. Creator and Pro unlock longer songs, priority queue, stems, and an API. We're finishing billing — drop your email and we'll write the day we open the gates."}
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
                  Most popular
                </span>
              ) : null}
            </header>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-medium">{tier.price}</span>
              <span className="text-sm text-foreground/50">{tier.cadence}</span>
            </div>
            <p className="text-sm text-foreground/70">{tier.pitch}</p>
            <ul className="flex flex-col gap-2 text-sm text-foreground/80">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-1 text-accent">
                    ◆
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-2">
              {tier.cta.kind === "primary" ? (
                <a
                  href={tier.cta.href}
                  className="block w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20"
                >
                  {tier.cta.label}
                </a>
              ) : billingEnabled && signedIn ? (
                <UpgradeButton
                  tier={tier.cta.tier}
                  label={`Upgrade to ${tier.label}`}
                />
              ) : billingEnabled ? (
                <a
                  href={`/sign-in?next=${encodeURIComponent("/pricing")}`}
                  className="block w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20"
                >
                  {`Upgrade to ${tier.label}`}
                </a>
              ) : (
                <WaitlistButton tier={tier.cta.tier} label={tier.cta.label} />
              )}
            </div>
          </article>
        ))}
      </section>
      <footer className="mx-auto max-w-2xl rounded-md border border-muted/20 bg-muted/5 px-6 py-4 text-center text-xs text-foreground/50">
        Prices in INR. Every tier ships generated audio at 44.1 kHz WAV.
        Stems and karaoke video are Creator+. <a href="/help" className="underline">FAQ</a>.
      </footer>
    </main>
  );
}
