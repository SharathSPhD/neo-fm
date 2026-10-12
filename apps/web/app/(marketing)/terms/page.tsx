import type { Metadata } from "next";
import Link from "next/link";

import { PlainSummary } from "@/components/legal/summary";

export const metadata: Metadata = {
  title: "Terms -- neo-fm",
  description: "The rules for using neo-fm: your songs, AI-generated content and ownership, acceptable use, plans and refunds.",
};

const SUMMARY = [
  "You must be 18 or older. You keep what you write; the songs are made by AI and licensed to you, so they may resemble existing music by coincidence.",
  "Don't imitate a real artist, copy someone's lyrics, or make hateful, sexual-minors, self-harm or extremist content. We screen automatically and may remove things.",
  "Public songs are labelled AI-generated. Anyone can report a song; we can take it off public view, and you can appeal to our Grievance Officer.",
  "Paid plans renew monthly through Stripe and you can cancel any time. You can export or delete your data from your account page.",
];

const SECTIONS: { h: string; body: string[] }[] = [
  { h: "Using neo-fm", body: ["You must be 18 or older. You are responsible for your account and for what you create. neo-fm is provided by Technektar."] },
  { h: "AI-generated content and ownership", body: [
    "What you write: you keep your briefs, and any dedication, title or description you add. You allow us to process them to make your song, to show them where you choose to publish them, and to keep your service safe.",
    "What we generate: lyrics, music and cover art are produced by AI models from third-party providers. Whether copyright exists in AI-generated material is unsettled and differs between countries, so we do not promise you copyright in it, and we do not promise that no one else receives a similar song. What we do promise: we claim no ownership of your songs, and we give you a worldwide, non-exclusive, perpetual licence to use them, including commercially on Pro, subject to these terms. We do not licence your private songs to anyone else and do not use them to train models.",
    "Similarity to existing works: outputs can resemble existing songs by coincidence. We screen for obvious cases (requests to copy a song, imitate a named artist, or lyrics that reproduce known songs), but no check is perfect. Before you release a song commercially, you are responsible for checking it and for meeting the rules of any store, distributor or collecting society you use, including any that require AI disclosure.",
    "Honest labelling: every public song is labelled as AI-generated. Please keep the label when you share, and do not present a song as sung by a human or by a real artist. Audio made with Google's Lyria models may carry an inaudible SynthID watermark.",
    "Provider terms: the AI providers we use have their own usage policies, which apply to what can be generated. If a provider's rules change what you may do with output, we will update this page." ] },
  { h: "Public songs, profiles, dedications and collections", body: [
    "By publishing a song you allow neo-fm to host, stream and display it, and to show it with your public handle and avatar on your creator profile. You can unpublish any time.",
    "A dedication (a recipient name up to 60 characters and a message up to 280) appears on the public song page and its share card. Dedicate only to people you are happy to name, never to harass or embarrass someone, and never include contact details or private information about others. Dedications are screened before they are saved.",
    "If you share a playlist or collection, its title and description are public in the same way and follow the same rules." ] },
  { h: "Acceptable use", body: [
    "Do not use neo-fm to imitate a real artist's voice or style as a target, reproduce copyrighted lyrics, target or demean real people, create hateful, sexual-minors, self-harm-encouraging or extremist content, or attempt to bypass our safety checks or limits. The full list, with examples and how we enforce it, is in our Content policy.",
    "We screen briefs and outputs automatically and may refuse a request, remove content, or suspend an account that breaks these rules." ] },
  { h: "Reports, takedowns and appeals", body: [
    "Anyone can report a public song from its page. We review reports and may dismiss them or take the song off public view. A song taken down stays in its owner's library but cannot be made public again unless we reinstate it. We email the owner and the people who reported it.",
    "To appeal or raise any other grievance, write to our Grievance Officer at grievance@neo-fm.com. We acknowledge within 24 hours and aim to resolve within 15 days. Repeated or serious breaches can lead to suspension. If you believe a song infringes your rights, send the song link and details to the same address." ] },
  { h: "Plans, credits and fair use", body: ["Free and paid plans include a monthly allowance of credits; unused credits do not roll over unless the plan says so. We may change limits with notice. Abuse of free allowances (multiple accounts, automation) can lead to suspension."] },
  { h: "Billing and refunds", body: ["Paid plans renew monthly through Stripe until cancelled; cancel any time from your account, effective at the end of the period. If a technical fault on our side prevents you using a paid period, contact us for a pro-rata refund. Taxes (including GST) are added where applicable."] },
  { h: "Your data", body: ["How we handle personal data is described in our Privacy notice. You can export your data or delete your account from your account page; deleting removes your songs, including published ones, so their links stop working."] },
  { h: "Availability and liability", body: ["The service is provided as is. Music generation depends on third-party AI services and may be delayed or unavailable. To the extent permitted by law, our liability is limited to the amount you paid in the 3 months before the claim."] },
  { h: "Changes", body: ["We will post material changes here and, for paying users, notify you by email before they apply."] },
  { h: "Law", body: ["These terms are governed by the laws of India; courts in Bengaluru have jurisdiction, subject to any mandatory consumer rights you have where you live."] },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of use</h1>
      <p className="mt-3 text-sm text-foreground/60">Last updated: 13 October 2026</p>
      <PlainSummary points={SUMMARY} />
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
        See also our <Link href="/privacy" className="underline">Privacy</Link> notice, <Link href="/content-policy" className="underline">Content policy</Link> and <Link href="/trust" className="underline">Trust &amp; safety</Link>.
      </p>
    </main>
  );
}
