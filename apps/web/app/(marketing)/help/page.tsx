/**
 * /help -- static FAQ (Sprint E).
 *
 * Static is intentional: the FAQ has answers that change with
 * the product, not with the user. We keep the markdown-style copy
 * inline so it ships with the bundle (no separate fetch).
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Help -- neo-fm",
  description:
    "Answers to the most-asked questions about neo-fm: how generation works, what we support, quota, ownership, and getting help.",
};

interface FaqEntry {
  q: string;
  a: React.ReactNode;
}

const FAQ: readonly FaqEntry[] = [
  {
    q: "How does neo-fm generate music?",
    a: (
      <p>
        We ship the song through a composition-aware pipeline: a co-composer
        elaborates your section list (raga / tala / orchestration), then
        HeartMuLa generates a 44.1 kHz stem on our DGX. A vocal-synth
        backend (Svara-TTS for Indic native script, Indic Parler-TTS for
        Hinglish / English) lays down the singing, and a mixer aligns and
        masters the final track. The whole loop usually takes 60-90 seconds.
      </p>
    ),
  },
  {
    q: "What styles do you support?",
    a: (
      <p>
        Carnatic, Hindustani, Kannada folk, and Western. Each style has its
        own section grammar (pallavi / anupallavi / charanam for Carnatic,
        mukhda / antara for Hindustani, etc) and its own preset gallery on
        the new-song page.
      </p>
    ),
  },
  {
    q: "What languages can I sing in?",
    a: (
      <p>
        Hindi, Kannada, and English. Hinglish (Hindi in Latin script) is
        treated as a first-class case and gets phoneme-hinted before
        synthesis (ADR 0020). Sanskrit shlokas in Devanagari work too --
        they share the Hindi pipeline.
      </p>
    ),
  },
  {
    q: "What's the free quota?",
    a: (
      <p>
        3 completed songs per UTC month, up to 90 seconds each. Failed
        renders don&apos;t count against your quota (ADR 0014). Want longer
        songs and a bigger budget? See <Link href="/pricing">pricing</Link>.
      </p>
    ),
  },
  {
    q: "Who owns the songs I generate?",
    a: (
      <p>
        You do. neo-fm grants you a perpetual, royalty-free licence to use
        the rendered audio anywhere, including commercial release. We
        retain a non-exclusive right to use it for product training and
        public showcases (you can opt out per song from the detail page).
      </p>
    ),
  },
  {
    q: "My song says 'Audio URL pending' forever. What do I do?",
    a: (
      <p>
        Click <strong>Recover</strong> on the row. Behind the scenes the
        button calls the orphan recovery RPC (ADR introduced in Sprint C),
        which re-queues the job from where it stalled. If the same job
        fails twice, drop us a note from the{" "}
        <Link href="/feedback">feedback form</Link>.
      </p>
    ),
  },
  {
    q: "Can I download stems?",
    a: (
      <p>
        Stems (vocal / melody / percussion) are a <Link href="/pricing">Creator+ feature</Link>.
        We export 44.1 kHz WAV per stem. The mastered mix is always
        downloadable on every tier.
      </p>
    ),
  },
  {
    q: "How do I delete my account?",
    a: (
      <p>
        Go to <Link href="/account">/account</Link> and use the
        <em> Delete account</em> button at the bottom. We anonymise your
        songs (the audio stays in the share index if you published it)
        and remove your PII within 30 days. Reach out before deleting if
        you&apos;d also like a data export.
      </p>
    ),
  },
];

export default function HelpPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          help
        </p>
        <h1 className="text-4xl font-medium tracking-tight">
          Frequently asked questions
        </h1>
        <p className="text-base text-foreground/60">
          Can&apos;t find what you&apos;re looking for? Send us a note from{" "}
          <Link href="/feedback" className="underline hover:text-foreground">
            /feedback
          </Link>{" "}
          -- we read every message.
        </p>
      </header>
      <section className="flex flex-col gap-6">
        {FAQ.map((entry) => (
          <details
            key={entry.q}
            className="group rounded-md border border-muted/20 bg-muted/5 px-5 py-4 open:border-muted/40"
          >
            <summary className="cursor-pointer text-base font-medium text-foreground/90 list-none flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 text-accent transition group-open:rotate-90"
              >
                ▸
              </span>
              <span>{entry.q}</span>
            </summary>
            <div className="prose prose-invert mt-3 pl-6 text-sm text-foreground/75">
              {entry.a}
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
