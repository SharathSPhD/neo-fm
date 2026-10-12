import { serverI18n } from "@/lib/i18n/server";
import { FunnelBeacon } from "@/components/funnel-beacon";
import { ListenFirst } from "@/components/listen-first";
import type { Metadata } from "next";
import Link from "next/link";

/**
 * v2 landing. Everything claimed here is something the product does today:
 *  - lyrics are written natively (not translated) by the Pratyabhijna-inspired lyric engine (K candidates, contrastive
 *    selection, meter/diction polish) running on Claude Managed Agents;
 *  - audio is rendered by Google Lyria 3.5 and is labelled AI-generated;
 *  - every song gets a pronunciation check (Gemini listens, we compare with the lyric).
 * No claims about file formats, in-house voice models or G2P packs that v2 does not ship.
 */

const LANGS = ["ಕನ್ನಡ Kannada", "தமிழ் Tamil", "తెలుగు Telugu", "हिन्दी Hindi", "বাংলা Bengali"] as const;

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
          <span key={i} className="text-accent">
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
  title: "neo-fm: AI songs in Kannada, Tamil, Telugu, Hindi and Bengali",
  alternates: { canonical: "/" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "neo-fm",
  description: "AI songs in Indian languages with native lyrics and a pronunciation check.",
  inLanguage: ["kn", "ta", "te", "hi", "bn", "en"],
  publisher: { "@type": "Organization", name: "Technektar" },
};

export default async function Page() {
  return (
    <main className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <FunnelBeacon event="landing_view" />
      <Hero />
      <ListenFirst />
      <HowItWorks />
      <Different />
      <PricingTeaser />
      <Footer />
    </main>
  );
}

function Hero() {
  const { t } = serverI18n();
  return (
    <section className="relative overflow-hidden border-b border-muted/30" aria-labelledby="hero-heading">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.15),_transparent_55%)]" />
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-20 sm:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
          <span aria-hidden>♬</span>
          {t("landing.badge")}
        </span>
        <h1 id="hero-heading" className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          <Accented text={t("landing.title")} />
        </h1>
        <p className="max-w-2xl text-lg text-foreground/75 sm:text-xl">
          {t("landing.subtitle")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sign-up" className="rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background">
            {t("landing.ctaPrimary")}
          </Link>
          <Link href="/discover" className="rounded-md border border-muted/50 px-5 py-2.5 font-medium text-foreground/90 hover:border-foreground/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent">
            {t("landing.ctaSecondary")}
          </Link>
        </div>
        <ul className="flex flex-wrap gap-2 pt-2" aria-label={t("landing.languages")}>
          {LANGS.map((l) => (
            <li key={l} className="rounded-full border border-muted/40 px-3 py-1 text-sm text-foreground/80">{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = serverI18n();
  return (
    <section className="border-t border-muted/30" aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="how-heading" className="text-3xl font-semibold tracking-tight">{t("landing.howTitle")}</h2>
        <ol className="mt-8 grid gap-5 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-muted/30 bg-muted/5 p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-sm font-medium text-accent" aria-hidden>{s.n}</span>
              <h3 className="mt-4 text-lg font-medium">{t(s.title)}</h3>
              <p className="mt-2 text-sm text-foreground/70">{t(s.body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Different() {
  const { t } = serverI18n();
  return (
    <section className="border-t border-muted/30" aria-labelledby="diff-heading">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="diff-heading" className="text-sm font-medium uppercase tracking-widest text-foreground/50">{t("landing.diffTitle")}</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DIFFERENT.map((d) => (
            <article key={d.title} className="rounded-xl border border-muted/30 bg-muted/5 p-6">
              <h3 className="text-base font-medium">{t(d.title)}</h3>
              <p className="mt-2 text-sm text-foreground/70">{t(d.body)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingTeaser() {
  const { t } = serverI18n();
  return (
    <section className="border-t border-muted/30" aria-labelledby="price-heading">
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

function Footer() {
  const { t } = serverI18n();
  return (
    <footer className="mx-auto max-w-6xl px-6 py-12 text-sm text-foreground/60">
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
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("nav.pricing")}
          </Link>
          <Link
            href="/trust"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.trust")}
          </Link>
          <Link
            href="/privacy"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.privacy")}
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.terms")}
          </Link>
          <Link
            href="/help"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("nav.help")}
          </Link>
          <Link
            href="/feedback"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {t("footer.contact")}
          </Link>
        </p>
      </div>
    </footer>
  );
}
