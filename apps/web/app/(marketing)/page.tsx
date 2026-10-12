import { ListenFirst } from "@/components/listen-first";
import type { Metadata } from "next";
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

const LANGS = ["ಕನ್ನಡ Kannada", "தமிழ் Tamil", "తెలుగు Telugu", "हिन्दी Hindi", "বাংলা Bengali"] as const;

const STEPS = [
  { n: 1, title: "Describe the song", body: "Tell us the mood, the occasion, the language and the style. One or two sentences is enough." },
  { n: 2, title: "Our lyric engine writes it", body: "It drafts several versions in your language and script, throws out clichés, picks the one that fits your brief best, then a second pass fixes meter and diction." },
  { n: 3, title: "Hear it, check it, share it", body: "A singer performs it. We listen back and show you how closely the pronunciation matches your lyrics. Keep it private or share a link." },
] as const;

const DIFFERENT = [
  { title: "Written natively", body: "Lyrics are composed in the target language and script with that language's rhyme and meter habits (prasa, edugai, antyaprasa), not translated from English." },
  { title: "Selection, not one lucky draw", body: "Every song is the winner of several candidates, scored for originality and fit to your brief. A final pass tightens meter and word choice." },
  { title: "Pronunciation you can verify", body: "After rendering, we transcribe the song and compare it with your lyrics, line by line, so you can see where the singer drifted." },
  { title: "Honest about AI", body: "Every song is labelled AI-generated. Our safety checks run before anything is rendered, and there is a clear way to report a song." },
] as const;

export const metadata: Metadata = {
  title: "neo-fm: AI songs in Kannada, Tamil, Telugu, Hindi and Bengali",
  alternates: { canonical: "/", languages: hreflangPaths() },
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(JSON_LD) }} />
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
  return (
    <section className="relative overflow-hidden border-b border-muted/30" aria-labelledby="hero-heading">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.15),_transparent_55%)]" />
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-20 sm:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
          <span aria-hidden>♬</span>
          Songs in the language you think in
        </span>
        <h1 id="hero-heading" className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          AI songs that get <span className="text-accent">Indian languages right</span>, down to the phoneme.
        </h1>
        <p className="max-w-2xl text-lg text-foreground/75 sm:text-xl">
          Describe a song in Kannada, Tamil, Telugu, Hindi or Bengali. Our lyric engine writes it natively, a singer performs it, and we check the pronunciation against your words.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sign-up" className="rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background">
            Make your first song free
          </Link>
          <Link href="/discover" className="rounded-md border border-muted/50 px-5 py-2.5 font-medium text-foreground/90 hover:border-foreground/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent">
            Listen to songs
          </Link>
        </div>
        <ul className="flex flex-wrap gap-2 pt-2" aria-label="Supported languages">
          {LANGS.map((l) => (
            <li key={l} className="rounded-full border border-muted/40 px-3 py-1 text-sm text-foreground/80">{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-muted/30" aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="how-heading" className="text-3xl font-semibold tracking-tight">From idea to share-link in three steps</h2>
        <ol className="mt-8 grid gap-5 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-muted/30 bg-muted/5 p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-sm font-medium text-accent" aria-hidden>{s.n}</span>
              <h3 className="mt-4 text-lg font-medium">{s.title}</h3>
              <p className="mt-2 text-sm text-foreground/70">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Different() {
  return (
    <section className="border-t border-muted/30" aria-labelledby="diff-heading">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="diff-heading" className="text-sm font-medium uppercase tracking-widest text-foreground/50">What makes it different</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DIFFERENT.map((d) => (
            <article key={d.title} className="rounded-xl border border-muted/30 bg-muted/5 p-6">
              <h3 className="text-base font-medium">{d.title}</h3>
              <p className="mt-2 text-sm text-foreground/70">{d.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingTeaser() {
  return (
    <section className="border-t border-muted/30" aria-labelledby="price-heading">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="price-heading" className="text-2xl font-semibold tracking-tight">Free to start. ₹299 when you want more.</h2>
          <p className="mt-2 max-w-xl text-sm text-foreground/70">Three free songs a month. Creator and Pro add more songs, longer tracks and our best lyric pass.</p>
        </div>
        <Link href="/pricing" className="rounded-md border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-medium text-accent hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-accent">See pricing</Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-6 py-12 text-sm text-foreground/60">
      <nav aria-label="Songs by language" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {LANGUAGE_PAGES.map((l) => (
          <Link
            key={l.code}
            href={languagePagePath(l)}
            hrefLang={l.code}
            lang={l.code}
            className="underline hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            {l.native}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p>
          © {new Date().getFullYear()} neo-fm · AI songs in Indian languages ·{" "}
          A product of{" "}
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
            Pricing
          </Link>
          <Link
            href="/trust"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Trust &amp; safety
          </Link>
          <Link
            href="/privacy"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Terms
          </Link>
          <Link
            href="/help"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Help
          </Link>
          <Link
            href="/feedback"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Contact
          </Link>
        </p>
      </div>
    </footer>
  );
}
