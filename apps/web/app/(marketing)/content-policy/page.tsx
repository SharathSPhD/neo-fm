import type { Metadata } from "next";
import Link from "next/link";

import { PlainSummary } from "@/components/legal/summary";

export const metadata: Metadata = {
  title: "Content policy -- neo-fm",
  description: "What you can and can't make or publish on neo-fm, how reports and takedowns work, and how to appeal.",
};

const SUMMARY = [
  "Make original music. Describe a sound, a mood, a story. Don't ask for a real artist's voice or style, or for an existing song's words.",
  "Nothing sexual involving minors, hateful or harassing, encouraging self-harm, or violent extremist. Dedications, titles and profile text follow the same rules.",
  "Anyone can report a public song. We can take it off public view; you can appeal to grievance@neo-fm.com.",
];

const SECTIONS: { h: string; items: string[] }[] = [
  { h: "Original work and other people's rights", items: [
    "Do not ask for a song in the voice or style of a named real artist, or to clone a voice. Describe the sound instead: instruments, tempo, raga, era, mood.",
    "Do not ask for the lyrics of an existing song, a word-for-word cover, or a remake of a specific song's words. Tell us the story or feeling and we will write new lyrics.",
    "Do not use neo-fm to infringe someone's copyright, trademark or personality rights. We stop lyrics that closely reproduce known songs before audio is made.",
    "We run these checks in English, Hindi, Tamil, Telugu, Kannada and Bengali. They are not perfect; if we miss something, report it." ] },
  { h: "Content we do not allow", items: [
    "Sexual content involving minors, in any form.",
    "Hate, harassment or demeaning content aimed at people or groups, including real private individuals.",
    "Content that encourages self-harm or suicide. If you are struggling, please reach out to a local helpline.",
    "Violent extremism, including songs that glorify or recruit for it.",
    "Attempts to trick or bypass our safety checks, or to make the system act against its rules." ] },
  { h: "What you publish", items: [
    "Titles, dedications, profile names and collection descriptions are public when the song or collection is. They are screened and must follow this policy.",
    "Dedicate only to people you are happy to name. Don't use a dedication to embarrass, threaten or expose someone, or to share private details.",
    "Public songs carry an AI-generated label. Do not present them as sung by a human or by a real artist." ] },
  { h: "How we enforce", items: [
    "We screen briefs and lyrics automatically before audio is made, and the safety checks fail closed.",
    "Reports are reviewed by a person. Outcomes: no action, or the song is removed from public view (it stays in the owner's library but cannot be republished unless reinstated). Owners and reporters are emailed.",
    "Serious or repeated breaches can lead to account suspension." ] },
  { h: "Reports, timelines and appeals", items: [
    "Report from the Report this song link on any public song, or write to grievance@neo-fm.com.",
    "We acknowledge within 24 hours. Content that is unlawful, impersonates a real person, is sexual content involving minors, or infringes copyright is removed within 36 hours of a valid notice. Other grievances are resolved within 15 days.",
    "To appeal a decision, write to grievance@neo-fm.com with the song link. We look again and, if we got it wrong, reinstate the song." ] },
];

export default function ContentPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Content policy</h1>
      <p className="mt-3 text-sm text-foreground/60">Last updated: 13 October 2026</p>
      <PlainSummary points={SUMMARY} />
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-medium">{s.h}</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-foreground/70">
              {s.items.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-12 text-sm text-foreground/60">
        See also our <Link href="/terms" className="underline">Terms</Link>, <Link href="/privacy" className="underline">Privacy</Link> notice and <Link href="/trust" className="underline">Trust &amp; safety</Link>.
      </p>
    </main>
  );
}
