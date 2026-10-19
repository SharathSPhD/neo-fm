import { serverI18n } from "@/lib/i18n/server";
import { createServerClient } from "@/lib/supabase/server";
import { FunnelBeacon } from "@/components/funnel-beacon";
import { HowVisual } from "@/components/landing/how-visual";
import { LanguageSamples } from "@/components/landing/language-samples";
import { SocialProof } from "@/components/landing/social-proof";
import { ListenFirst } from "@/components/listen-first";
import { loadLanguageSamples } from "@/lib/landing/samples";
import type { Metadata } from "next";
import { SongOfTheDay } from "@/components/song-of-the-day";
import Link from "next/link";


import { LANGUAGE_PAGES, hreflangPaths, languagePagePath } from "@/lib/seo/language-pages";
import { jsonLdString } from "@/lib/seo/jsonld";

/**
 * v2 landing. Everything claimed here is something the product does today:
 *  - lyrics are written natively (not translated) by the Pratyabhijna-inspired lyric engine (K candidates, contrastive
 *    selection, meter/diction polish) running on Claude Managed Agents;
 *  - audio is rendered by Google Lyria 3.5 and is labelled AI-generated;
 *  - every song gets a pronunciation check (Gemini listens, we compare with the lyric).
 * No claims about file formats, in-house voice models or G2P packs that v2 does not ship.
 */

const STEPS = [
  { n: 1, title: "landing.step1.title", body: "landing.step1.body" },
  { n: 2, title: "landing.step2.title", body: "landing.step2.body" },
  { n: 3, title: "landing.step3.title", body: "landing.step3.body" },
] as const;

const DIFFERENT = [
  { title: "landing.diff1.title", body: "landing.diff1.body" },
  { title: "landing.diff2.title", body: "landing.diff2.body" },
  { title: "landing.diff3.title", body: "landing.diff3.body" },
  { title: "landing.diff4.title", body: "landing.diff4.body" },
] as const;

/** Renders "plain [[accented]] plain" with the middle part highlighted. */
function Accented({ text }: { text: string }) {
  return (
    <>
      {text.split(/\[\[|\]\]/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-aurora">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export const metadata: Metadata = {
  title: "neo-fm: your personal FM, in Kannada, Tamil, Telugu, Hindi and Bengali",
  description:
    "Songs made for you in the language you think in. Native lyrics, a singer, and a pronunciation check on every track. Free to start; share any song in one tap.",
  alternates: { canonical: "/", languages: hreflangPaths() },
};

const WHAT = [
  { title: "landing.what1.title", body: "landing.what1.body" },
  { title: "landing.what2.title", body: "landing.what2.body" },
  { title: "landing.what3.title", body: "landing.what3.body" },
] as const;

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "neo-fm",
  description: "Your personal 24/7 FM station: AI-generated music tuned to your taste, Indian languages first.",
  inLanguage: ["kn", "ta", "te", "hi", "bn", "en"],
  publisher: { "@type": "Organization", name: "Technektar" },
};

export default async function Page() {
  return (
    <main className="relative min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(JSON_LD) }} />
      <FunnelBeacon event="landing_view" />
      <Hero />
      <WhatIs />
      <div className="mx-auto max-w-6xl px-6 pt-12">
        <SongOfTheDay />
      </div>
      <ListenFirst />
      <HowItWorks />
      <SocialProof />
      <Different />
      <PricingTeaser />
      <Footer />
    </main>
  );
}

async function Hero() {
  const { t } = await serverI18n();
  const samples = await loadLanguageSamples();
  const { data: auth } = await createServerClient().auth.getUser();
  const signedIn = Boolean(auth?.user);
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-heading">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-20 sm:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
          <span className="eq" aria-hidden><i /><i /><i /><i /></span>
          {t("landing.badge")}
        </span>
        <h1 id="hero-heading" className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl md:text-7xl">
          <Accented text={t("landing.title")} />
        </h1>
        <p className="max-w-2xl text-lg text-foreground/75 sm:text-xl">
          {t("landing.subtitle")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/station" className="rounded-full bg-accent px-6 py-3 font-medium text-background shadow-[0_0_36px_-6px_hsl(var(--accent))] transition hover:bg-accent/90 hover:shadow-[0_0_44px_-4px_hsl(var(--accent))] focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background">
            {t("landing.ctaListen")}
          </Link>
          <Link href={signedIn ? "/songs/new" : "/sign-up?next=/songs/new"} className="glass rounded-full px-6 py-3 font-medium text-foreground/90 hover:border-foreground/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent">
            {signedIn ? t("landing.ctaMake") : t("landing.ctaPrimary")}
          </Link>
          <Link href="/discover" className="glass rounded-full px-6 py-3 font-medium text-foreground/90 hover:border-foreground/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent">
            {t("landing.ctaSecondary")}
          </Link>
        </div>
        <p className="text-xs text-foreground/60">{t("landing.notice")}</p>
        <LanguageSamples samples={samples} />
      </div>
    </section>
  );
}

async function WhatIs() {
  const { t } = await serverI18n();
  return (
    <section className="border-b border-muted/30" aria-labelledby="what-heading">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <h2 id="what-heading" className="text-2xl font-semibold tracking-tight">{t("landing.whatTitle")}</h2>
        <ul className="mt-6 grid gap-5 sm:grid-cols-3">
          {WHAT.map((w) => (
            <li key={w.title}>
              <h3 className="font-medium">{t(w.title)}</h3>
              <p className="mt-1 text-sm text-foreground/70">{t(w.body)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

async function HowItWorks() {
  const { t } = await serverI18n();
  return (
    <section aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="how-heading" className="text-3xl font-semibold tracking-tight">{t("landing.howTitle")}</h2>
        <ol className="mt-8 grid gap-5 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="glass glass-hover rounded-2xl p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-sm font-medium text-accent" aria-hidden>{s.n}</span>
              <h3 className="mt-4 text-lg font-medium">{t(s.title)}</h3>
              <p className="mt-2 text-sm text-foreground/70">{t(s.body)}</p>
            </li>
          ))}
        </ol>
        <HowVisual />
      </div>
    </section>
  );
}

async function Different() {
  const { t } = await serverI18n();
  return (
    <section aria-labelledby="diff-heading">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="diff-heading" className="text-sm font-medium uppercase tracking-widest text-foreground/50">{t("landing.diffTitle")}</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DIFFERENT.map((d) => (
            <article key={d.title} className="glass glass-hover rounded-2xl p-6">
              <h3 className="text-base font-medium">{t(d.title)}</h3>
              <p className="mt-2 text-sm text-foreground/70">{t(d.body)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

async function PricingTeaser() {
  const { t } = await serverI18n();
  return (
    <section aria-labelledby="price-heading">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="price-heading" className="text-2xl font-semibold tracking-tight">{t("landing.priceTitle")}</h2>
          <p className="mt-2 max-w-xl text-sm text-foreground/70">{t("landing.priceBody")}</p>
        </div>
        <Link href="/pricing" className="rounded-md border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-medium text-accent hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-accent">{t("landing.seePricing")}</Link>
      </div>
    </section>
  );
}

async function Footer() {
  const { t } = await serverI18n();
  return (
    <footer className="mx-auto max-w-6xl px-6 py-12 text-sm text-foreground/60">
      <nav aria-label="Songs by language" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {LANGUAGE_PAGES.map((l) => (
          <Link
            key={l.code}
            href={languagePagePath(l)}
            hrefLang={l.code}
            lang={l.code}
            className="inline-flex min-h-8 items-center underline hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {l.native}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p>
          © {new Date().getFullYear()} neo-fm · {t("landing.tagline")} ·{" "}
          {t("landing.productOf")}{" "}
          <a
            href="https://technektar.com"
            rel="noopener"
            className="underline hover:text-foreground"
          >
            Technektar
          </a>
        </p>
        <p className="flex flex-wrap items-center gap-4 text-xs text-foreground/50">
          <Link
            href="/pricing"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("nav.pricing")}
          </Link>
          <Link
            href="/trust"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.trust")}
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.privacy")}
          </Link>
          <Link
            href="/terms"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.terms")}
          </Link>
          <Link
            href="/ai-disclosure"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.ai")}
          </Link>
          <Link
            href="/help"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("nav.help")}
          </Link>
          <Link
            href="/feedback"
            className="inline-flex min-h-8 items-center hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.contact")}
          </Link>
        </p>
      </div>
    </footer>
  );
}
