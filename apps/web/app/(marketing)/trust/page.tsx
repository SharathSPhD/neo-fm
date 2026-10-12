/**
 * /trust -- public responsible-AI commitments. Every claim here maps to code
 * or a documented vendor behaviour; if the product changes, change this page.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trust & safety -- neo-fm",
  description:
    "How neo-fm keeps AI music honest: original lyrics, no voice cloning, labelled AI audio, fail-closed safety checks and clear privacy limits.",
};

const COMMITMENTS: readonly { title: string; body: React.ReactNode }[] = [
  {
    title: "Original lyrics, never copied",
    body: "Our lyric engine writes new words for every song. Requests to reproduce an existing song's lyrics are declined before any generation happens.",
  },
  {
    title: "No voice cloning, no imitation of real artists",
    body: "You can describe a sound: instruments, raga, mood, tempo. You can't ask for a real artist's voice or name them as the target. Those requests are blocked, and so is any attempt to work around the rule.",
  },
  {
    title: "Honest labelling",
    body: (
      <>
        Everything made here is AI-generated and we say so. According to
        Google&apos;s documentation, audio from its Lyria models carries an
        inaudible SynthID watermark that helps platforms identify
        AI-generated music. Please keep the AI-generated label when you
        share a track.
      </>
    ),
  },
  {
    title: "Safety checks that fail closed",
    body: "Your brief is checked by fixed rules and by an AI reviewer before any song is made, and the lyrics are checked again just before audio is rendered. If a check can't run, we don't generate. We block sexual content involving minors, hate and harassment, encouragement of self-harm, and violent extremism.",
  },
  {
    title: "Spending limits you can trust",
    body: "Each plan has monthly song limits, and audio rendering sits behind a global spend cap enforced in the database, so a bug or a bad actor can't run up costs that end up in your price.",
  },
  {
    title: "Your data",
    body: "Your briefs and songs are stored to run your account and are visible only to you unless you publish a track. We don't sell your data. You can export your data, delete a song, or delete your whole account from Settings.",
  },
];

export default function TrustPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Trust &amp; safety</h1>
      <p className="mt-3 text-foreground/70">
        neo-fm, a Technektar product, is built for Indian languages and for people
        who love music. These are the rules we hold ourselves to.
      </p>
      <ul className="mt-10 space-y-8">
        {COMMITMENTS.map((c) => (
          <li key={c.title}>
            <h2 className="text-lg font-medium">{c.title}</h2>
            <p className="mt-1 text-foreground/70">{c.body}</p>
          </li>
        ))}
      </ul>
      <section className="mt-12 rounded-lg border border-muted/30 p-5" aria-labelledby="grievance-heading">
        <h2 id="grievance-heading" className="text-lg font-medium">Reports, takedowns and grievances</h2>
        <p className="mt-2 text-sm text-foreground/70">
          Every public song has a <strong>Report this song</strong> link. You can also write to our Grievance Officer at{" "}
          <a className="underline" href="mailto:grievance@neo-fm.com">grievance@neo-fm.com</a> (Technektar). We acknowledge complaints within 24 hours,
          remove content that is unlawful, impersonates a real person, is sexual content involving minors, or infringes copyright within 36 hours of a valid
          notice, and resolve other grievances within 15 days.
        </p>
        <p className="mt-2 text-sm text-foreground/60">
          Not a report?{" "}
          <Link href="/feedback" className="underline">Send us feedback</Link>.
        </p>
      </section>
    </main>
  );
}
