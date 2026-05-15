import Link from "next/link";
import { PRESETS } from "@neo-fm/style-presets";

/**
 * Sprint 8 / M6 — India-first marketing landing.
 *
 * The page is built as a static server component so it renders fast
 * for cold visitors. Pulled directly from the style-presets package
 * so the gallery is the same source of truth used by the creation
 * canvas — adding a new preset upstream updates this page for free.
 *
 * Light/dark: we treat the dark palette in globals.css as the canonical
 * theme. WCAG AA contrast is verified for the foreground/background
 * tokens; the accent colour is only used for non-text affordances or
 * on dark surfaces where AA is comfortably met.
 */

const VALUE_PROPS = [
  {
    title: "Composition-aware",
    body:
      "Not a TTS hack. neo-fm models verse / sthayi / pallavi and lets the co-composer pick the right raga, tala, and orchestration for the style you chose.",
  },
  {
    title: "India-first by design",
    body:
      "Carnatic, Hindustani, and Kannada-folk co-composers are built in. Hindi, Kannada, Tamil, Telugu, and Bengali vocals render in Devanagari, Tamil, Kannada, Telugu, and Bengali scripts.",
  },
  {
    title: "From one line to a song",
    body:
      "Pick a template, type a verse, hit Generate. Section regeneration lets you keep what works and re-roll only the parts you don't like.",
  },
  {
    title: "Own what you make",
    body:
      "Songs you make are yours: download as 48 kHz WAV, publish to a public share URL, embed in your blog, or keep private. Public-domain lyrics are clearly attributed.",
  },
] as const;

const HIGHLIGHT_PRESET_IDS = [
  "carnatic-kriti",
  "hindustani-khayal-sketch",
  "kannada-bhavageete",
  "kabir-doha",
  "tagore-rabindra-sangeet",
  "bollywood-ballad",
  "tamil-folk",
  "western-pop",
] as const;

const HIGHLIGHT_PRESETS = HIGHLIGHT_PRESET_IDS.map((id) =>
  PRESETS.find((p) => p.id === id),
).filter((p): p is (typeof PRESETS)[number] => Boolean(p));

export default function Page() {
  return (
    <main className="min-h-screen">
      <SiteHeader />
      <Hero />
      <ValueProps />
      <StyleGallery />
      <HowItWorks />
      <Footer />
    </main>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-muted/30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          aria-label="neo-fm home"
          className="text-lg font-semibold tracking-tight"
        >
          neo-fm
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
          <Link
            href="/sign-in"
            className="rounded-md border border-muted/40 px-3 py-1.5 text-foreground/80 hover:border-foreground/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section
      className="relative overflow-hidden border-b border-muted/30"
      aria-labelledby="hero-heading"
    >
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.15),_transparent_55%)]" />
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-24 sm:py-32">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
          <span aria-hidden>♬</span>
          India-first AI music
        </span>
        <h1
          id="hero-heading"
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
          Make a Carnatic kriti, a Kabir doha, or a bedroom-pop hook —
          <span className="text-accent"> in one minute</span>.
        </h1>
        <p className="max-w-2xl text-lg text-foreground/75 sm:text-xl">
          neo-fm is a composition-aware music model that understands raga,
          tala, and Indic phonetics. Pick a style, write a line, and get a
          full song with mixed vocals in your language.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
          >
            Start free
          </Link>
          <Link
            href="/songs/new"
            className="rounded-md border border-muted/50 px-5 py-2.5 font-medium text-foreground/90 hover:border-foreground/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            See the templates
          </Link>
          <a
            href="https://github.com/SharathSPhD/neo-fm"
            className="rounded-md px-2 py-2 text-foreground/70 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            View source ↗
          </a>
        </div>
        <dl className="grid grid-cols-3 gap-6 pt-4 text-sm text-foreground/70 sm:gap-12">
          <div>
            <dt className="text-foreground/50">Languages</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              6 incl. हिन्दी ⋅ ಕನ್ನಡ ⋅ தமிழ்
            </dd>
          </div>
          <div>
            <dt className="text-foreground/50">Styles</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              Carnatic ⋅ Hindustani ⋅ Pop
            </dd>
          </div>
          <div>
            <dt className="text-foreground/50">Output</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              48 kHz stereo WAV
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function ValueProps() {
  return (
    <section
      className="border-b border-muted/30"
      aria-labelledby="value-props-heading"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2
          id="value-props-heading"
          className="text-sm font-medium uppercase tracking-widest text-foreground/60"
        >
          What makes it different
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE_PROPS.map((p) => (
            <article
              key={p.title}
              className="rounded-xl border border-muted/30 bg-muted/10 p-6"
            >
              <h3 className="text-lg font-semibold text-foreground">
                {p.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-foreground/75">
                {p.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function StyleGallery() {
  return (
    <section
      className="border-b border-muted/30"
      aria-labelledby="style-gallery-heading"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-baseline justify-between gap-4">
          <h2
            id="style-gallery-heading"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Eight starting points
          </h2>
          <Link
            href="/songs/new"
            className="text-sm text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Open template gallery →
          </Link>
        </div>
        <p className="mt-3 max-w-2xl text-foreground/70">
          Hand-curated Song Documents — pick one to seed the creation
          canvas. You can rewrite the lyrics, change the language, swap the
          raga, or regenerate any section.
        </p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHT_PRESETS.map((preset) => (
            <li key={preset.id}>
              <Link
                href={`/songs/new?preset=${encodeURIComponent(preset.id)}`}
                className="group flex h-full flex-col gap-3 rounded-xl border border-muted/30 bg-muted/10 p-5 transition hover:border-accent/50 hover:bg-muted/20 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-semibold text-foreground group-hover:text-accent">
                    {preset.title}
                  </h3>
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider text-foreground/40"
                    aria-hidden
                  >
                    {preset.song_document.style_family}
                  </span>
                </div>
                <p className="text-xs uppercase tracking-wider text-foreground/50">
                  {preset.subtitle}
                </p>
                <p className="text-sm text-foreground/70">
                  {preset.description}
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  {preset.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-muted/40 bg-background/40 px-2 py-0.5 text-[11px] text-foreground/70"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      className="border-b border-muted/30"
      aria-labelledby="how-it-works-heading"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2
          id="how-it-works-heading"
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          From idea to share-link in three steps
        </h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          <Step
            n={1}
            title="Pick a template"
            body="Carnatic kriti, Hindustani khayal sketch, Kannada bhavageete, or a public-domain Kabir doha. Each one is a complete Song Document; you can edit anything."
          />
          <Step
            n={2}
            title="Write your verse"
            body="Type lyrics in Devanagari, Tamil, Kannada, Telugu, Bengali, or Latin. Length caps and a blocklist keep things safe; transliteration helps the vocal model."
          />
          <Step
            n={3}
            title="Generate, regenerate, share"
            body="48 kHz WAV in your library, section-level regenerate when you want a different bridge, one-click publish with an OG-card-friendly share page and embed."
          />
        </ol>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            href="/sign-up"
            className="rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
          >
            Create your account
          </Link>
          <Link
            href="/sign-in"
            className="text-sm text-foreground/70 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Already have one? Sign in →
          </Link>
        </div>
      </div>
    </section>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-muted/30 bg-muted/10 p-6">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 font-mono text-sm font-semibold text-accent">
        {n}
      </span>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-foreground/75">{body}</p>
    </li>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-6 py-12 text-sm text-foreground/60">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p>
          neo-fm · Apache-2.0 ·{" "}
          <a
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
            href="https://github.com/SharathSPhD/neo-fm"
          >
            github.com/SharathSPhD/neo-fm
          </a>
        </p>
        <p className="text-xs text-foreground/40">
          Made with HeartMuLa-OSS-3B · Indic vocals by kenpath/svara-tts-v1.
        </p>
      </div>
    </footer>
  );
}
