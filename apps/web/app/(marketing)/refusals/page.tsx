import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/refusals" },
  title: "What we refuse -- neo-fm",
  description: "The short list of things neo-fm will not make, and everything it happily does.",
};

const REFUSE: { h: string; body: string }[] = [
  { h: "A real person's voice or likeness", body: "No voice clones, deepfakes or songs sung \"as\" a real, named person." },
  { h: "Named-artist impersonation", body: "No \"in the style of\" a named living artist as a target. Describe the genre, mood, instruments or era instead." },
  { h: "Copyrighted lyrics", body: "We write original lyrics. We do not reproduce someone else's song text." },
  { h: "Sexually explicit content", body: "No graphic sex or pornographic lyrics. Romance, longing and sensual imagery are welcome; describe the feeling rather than the act." },
  { h: "Hate and extremism", body: "Content that attacks people for who they are, or promotes violent extremism or self-harm." },
  { h: "Sexual content involving minors", body: "Never, in any form." },
  { h: "Defamation of real people", body: "False factual accusations of crimes or misconduct about a named real person." },
  { h: "Campaigning for or against a party or candidate", body: "Election persuasion is out. Songs on civic themes or public issues, with no party or candidate named, are fine." },
  { h: "Passing AI off as human, or dodging our checks", body: "Do not remove the AI label, bypass our safety checks or limits, or resell access." },
];

const ALLOW = "Romance, heartbreak, devotion and prayer, protest and satire about public issues, lullabies, festival and wedding songs, birthday and family dedications, regional and folk styles, and anything else that is not on the list above. When we are unsure, we allow it.";

export default function RefusalsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">What we refuse</h1>
      <p className="mt-3 text-sm text-foreground/60">Last updated: October 2026</p>
      <p className="mt-6 text-foreground/70">We keep this list short on purpose. Briefs and outputs are checked automatically. A refusal tells you which rule applied, keeps your words in the box, and lets you reword and try again.</p>
      <ul className="mt-8 space-y-6">
        {REFUSE.map((r) => (
          <li key={r.h}>
            <h2 className="text-lg font-medium">{r.h}</h2>
            <p className="mt-1 text-foreground/70">{r.body}</p>
          </li>
        ))}
      </ul>
      <section className="mt-10">
        <h2 className="text-lg font-medium">Everything else is welcome</h2>
        <p className="mt-1 text-foreground/70">{ALLOW}</p>
      </section>
      <p className="mt-12 text-sm text-foreground/60">
        Think we got it wrong? Use <Link href="/feedback" className="underline">Feedback</Link> or the <Link href="/grievance" className="underline">Complaints &amp; takedowns</Link> page. See also the <Link href="/terms" className="underline">Terms</Link> and <Link href="/ai-disclosure" className="underline">AI disclosure</Link>.
      </p>
    </main>
  );
}
