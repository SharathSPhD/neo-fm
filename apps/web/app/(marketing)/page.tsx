import Link from "next/link";
import { PRESETS } from "@neo-fm/style-presets";

/**
 * v1.3 Sprint 5 — Wedge landing page.
 *
 * The wedge: **the only AI music platform that gets Indian languages
 * right at the phoneme level.** Every other surface — Suno, Udio,
 * Riffusion, Boomy — butchers schwa-deletion, anusvara assimilation,
 * and aspirated-stop pairs. We don't. Sprint 4 ships the rule packs
 * that make this concrete; this landing page tells that story.
 *
 * Reorientation vs the v1.2 landing:
 *   - H1 leads with the phoneme promise, not generic "India-first".
 *   - Value props are now (1) phoneme-correct vocals, (2) composition-
 *     aware structure (raga/tala/section), (3) editable Song Document,
 *     (4) own-your-output.
 *   - New "Listen" section anchors three A/B Indic samples produced
 *     by Sprint 4's pipeline so visitors can hear the wedge before
 *     they sign up.
 *   - "How it works" still 3 steps but the language step calls out
 *     phoneme-level rendering by name.
 *
 * Static server component for speed. Pulls presets from
 * `@neo-fm/style-presets` so the gallery shares a source of truth
 * with the creation canvas — adding a preset upstream updates this
 * page for free. WCAG AA contrast is verified for the dark palette
 * we treat as canonical (light mode mirrors).
 */

const VALUE_PROPS = [
  {
    title: "Phoneme-correct Indic vocals",
    body:
      "Most AI music tools tokenise Hindi or Kannada like English — schwas linger, anusvara collapses to a flat /n/, aspirated stops vanish. neo-fm runs rule-packed grapheme-to-phoneme on every line before the singer hears it. The singer hears Devanagari the way it's spoken.",
  },
  {
    title: "Composition-aware structure",
    body:
      "Verse / sthayi / pallavi / anupallavi / charanam aren't just labels — the co-composer picks the right raga, tala, and orchestration for the style you chose, and the model sees that structure as conditioning signal.",
  },
  {
    title: "Editable source documents",
    body:
      "Every song is a Song Document you can read, fork, remix, and re-render. Change the lyrics, change the raga, change the tempo — keep what worked, regenerate the bridge. No black-box prompt-to-mp3.",
  },
  {
    title: "Own what you make",
    body:
      "48 kHz stereo WAV download, publish to a public share URL, embed in your blog, or keep private. Public-domain lyrics are clearly attributed. The model output is yours under our usage terms.",
  },
] as const;

const LISTEN_SAMPLES = [
  {
    title: "Hindi (Devanagari) — Hindustani khayal sketch",
    body:
      "Raga Yaman, vilambit teentaal. Listen for the word-final schwa drop on \u201cnamaskaar\u201d and the anusvara turning into /ng/ on \u201cshankh\u201d. v1 pipeline kept the schwa; v1.3 doesn\u2019t.",
    preset: "hindustani-khayal-sketch",
  },
  {
    title: "Kannada — bhavageete",
    body:
      "Compound-duple 6/8, harmonium-led. The geminated /mm/ in \u201cnamma\u201d (\u0CA8\u0CAE\u0CCD\u0CAE) renders as two distinct phonemes rather than one — the rule pack splits virama clusters before the singer sees them.",
    preset: "kannada-bhavageete",
  },
  {
    title: "Tamil — parai-folk",
    body:
      "Janapada 4/4 dance, parai + thavil. v1.3 canonicalises Tamil-script lyrics to a Roman intermediate the singer can parse; deeper Tamil phonology lands in v1.4.",
    preset: "tamil-folk",
  },
] as const;

// IDs must match `packages/style-presets/src/index.ts`. The card grid
// silently drops any miss — Sprint 2 (v1.3) caught a stale
// "tagore-rabindra-sangeet" ID that had been dropping the eighth card
// for months; the correct id is "tagore-set".
const HIGHLIGHT_PRESET_IDS = [
  "carnatic-kriti",
  "hindustani-khayal-sketch",
  "kannada-bhavageete",
  "kabir-doha",
  "tagore-set",
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
      <Hero />
      <ValueProps />
      <Listen />
      <StyleGallery />
      <HowItWorks />
      <Footer />
    </main>
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
          Indic vocals, sung the way you wrote them
        </span>
        <h1
          id="hero-heading"
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
          The only AI music platform that gets
          <span className="text-accent"> Indian languages right at the phoneme level</span>.
        </h1>
        <p className="max-w-2xl text-lg text-foreground/75 sm:text-xl">
          Schwa-deletion, anusvara assimilation, aspirated stops, geminated
          consonants — neo-fm hears Devanagari, Kannada, and Tamil the way you
          speak them, not the way an English tokeniser guesses. Write a line,
          pick a style, and ship a song whose vocals don&rsquo;t sound like
          a stranger reading a phrasebook.
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
          <Link
            href="/discover"
            className="rounded-md px-2 py-2 text-foreground/70 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Listen first →
          </Link>
        </div>
        <dl className="grid grid-cols-3 gap-6 pt-4 text-sm text-foreground/70 sm:gap-12">
          <div>
            <dt className="text-foreground/50">G2P rule packs</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              हिन्दी · ಕನ್ನಡ · தமிழ்
            </dd>
          </div>
          <div>
            <dt className="text-foreground/50">Co-composers</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              Carnatic · Hindustani · Folk · Pop
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

function Listen() {
  return (
    <section
      className="border-b border-muted/30"
      aria-labelledby="listen-heading"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-baseline justify-between gap-4">
          <h2
            id="listen-heading"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Hear the difference
          </h2>
          <Link
            href="/discover"
            className="rounded text-sm text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Listen to more songs &rarr;
          </Link>
        </div>
        <p className="mt-3 max-w-2xl text-foreground/70">
          Three anchor samples produced by the v1.3 pipeline. Each one calls
          out a specific phonetic rule the rest of the field gets wrong.
          Open the template to read the Song Document, the phonemes, and
          regenerate the section yourself.
        </p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-3">
          {LISTEN_SAMPLES.map((sample) => (
            <li key={sample.preset}>
              <Link
                href={`/songs/new?preset=${encodeURIComponent(sample.preset)}`}
                className="group flex h-full flex-col gap-3 rounded-xl border border-muted/30 bg-muted/10 p-6 transition hover:border-accent/50 hover:bg-muted/20 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <h3 className="text-base font-semibold text-foreground group-hover:text-accent">
                  {sample.title}
                </h3>
                <p className="text-sm leading-relaxed text-foreground/75">
                  {sample.body}
                </p>
                <span className="mt-auto text-xs uppercase tracking-wider text-accent">
                  Open template &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
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
            body="Carnatic kriti, Hindustani khayal, Kannada bhavageete, Tamil parai-folk, or a public-domain Kabir doha. Each one is a complete Song Document — you can edit anything."
          />
          <Step
            n={2}
            title="Write your verse"
            body="Type lyrics in Devanagari, Tamil, Kannada, Telugu, Bengali, or Latin. We run rule-packed G2P on every line so the singer gets phonemes, not graphemes — schwas drop where they should, anusvara assimilates correctly, geminates stay distinct."
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
          © {new Date().getFullYear()} neo-fm · Phoneme-correct AI music for Indian languages
        </p>
        <p className="flex flex-wrap items-center gap-4 text-xs text-foreground/50">
          <Link
            href="/pricing"
            className="hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            Pricing
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
