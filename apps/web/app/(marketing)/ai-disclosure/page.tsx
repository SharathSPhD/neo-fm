import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/ai-disclosure" },
  title: "AI disclosure -- neo-fm",
  description: "What on neo-fm is made by AI, which AI services we use, how we label it and what we never do.",
};

const SECTIONS: { h: string; body: string[] }[] = [
  { h: "Everything here is AI-made", body: [
    "All songs, lyrics, cover art and spoken station lines on neo-fm are produced by AI systems. Nothing is a recording of a human singer or speaker. Where video is offered, it is AI-generated too.",
    "We label AI-made audio and video as AI-made inside the app, on share pages, on shared clips and in the spoken station lines. Please keep the label when you share." ] },
  { h: "Which AI services we use", body: [
    "Anthropic's Claude writes and reviews lyrics and checks requests for safety. Google's Gemini and Lyria models render audio, speech and, where offered, video. Google states that audio from its Lyria models carries an inaudible SynthID watermark. These providers process your request to produce the result; see our Privacy notice." ] },
  { h: "What we never do", body: [
    "We do not clone voices or recreate the voice or likeness of real people, we do not imitate a named artist as a target, and we do not reproduce copyrighted lyrics. We do not use your private songs to train models.",
    "We do not use AI to write fake reviews, fake testimonials or fake endorsements, and sponsored spots are always marked as sponsored." ] },
  { h: "Limits you should know about", body: [
    "AI can make mistakes. Pronunciation in some languages may not match a native speaker's, lyrics may resemble existing works by coincidence, and a song may not suit its occasion. Our quality checks use AI judges, and we have not yet had a native-speaker panel sign off every language.",
    "Songs are not professional, legal, medical or financial advice. Do not rely on a song's content as fact." ] },
  { h: "Your songs and ownership", body: [
    "Copyright in purely AI-generated material is unsettled in many countries, including India. We give you a licence to use your songs as set out in the Terms; we cannot promise exclusive ownership, and similar songs may be made for others." ] },
  { h: "Reporting a problem", body: [
    "If a song looks like a real person's voice, copies someone's work, is hateful or unsafe, or is wrongly labelled, report it from the song page or use the grievance process." ] },
];

export default function AiDisclosurePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">AI disclosure</h1>
      <p className="mt-3 text-sm text-foreground/60">Last updated: October 2026</p>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-medium">{s.h}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-2 text-foreground/70">{p}</p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-12 text-sm text-foreground/60">
        See also <Link href="/trust" className="underline">Trust &amp; safety</Link>, <Link href="/terms" className="underline">Terms</Link>, <Link href="/privacy" className="underline">Privacy</Link> and <Link href="/grievance" className="underline">Complaints &amp; takedowns</Link>.
      </p>
    </main>
  );
}
