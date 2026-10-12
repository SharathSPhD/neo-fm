import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  title: "Privacy -- neo-fm",
  description: "What neo-fm collects, why, who processes it, and the choices you have.",
};

const SECTIONS: { h: string; body: string[] }[] = [
  { h: "Who we are", body: ["neo-fm is a product of Technektar (\"we\"). We act as the data fiduciary for the personal data described here under India's Digital Personal Data Protection Act, 2023, and apply the same principles to users everywhere."] },
  { h: "What we collect", body: [
    "Account data: email address, display name or handle, and your sign-in method (email/password or Google). We never see your Google password.",
    "Content you create: the briefs you type, the lyrics and songs generated for you, and your library, likes and share settings.",
    "Usage and safety data: request logs, quota counters and the outcome of our automated safety checks, kept to protect the service and other users.",
    "Anonymous page counts: we count visits to our landing, pricing, sign-up and shared-song pages as a daily total. No cookie, IP address, device or account identifier is stored with the count, and we skip it entirely if your browser sends Do Not Track or Global Privacy Control.",
    "Payment data: handled by Stripe. We receive your plan status and a customer reference, never your card number." ] },
  { h: "Why we use it", body: ["To make songs for you, run your account, enforce fair-use limits, keep the service safe, and bill paid plans. We do not sell personal data and do not use your private songs to train models."] },
  { h: "Who processes it", body: [
    "Anthropic (Claude) writes and reviews lyrics from your brief. Google (Gemini and Lyria) renders and checks the audio. Supabase stores data. Vercel hosts the app. Stripe processes payments. Each receives only what it needs to do its job.",
    "Your brief and lyrics are sent to these processors to produce your song; audio you share publicly is visible to anyone with its link." ] },
  { h: "Public songs", body: ["Songs you publish are public (or unlisted) and may appear on Discover. Unpublish any time from the song page. Private songs are only visible to you."] },
  { h: "Your choices", body: ["You can access, correct, export or delete your data, withdraw consent, and nominate someone to exercise these rights, by writing to us through the Contact page. Deleting your account removes your songs and audio, subject to short backup retention and legal obligations."] },
  { h: "Children", body: ["neo-fm is not for people under 18. We do not knowingly collect data from children; if you believe a child has signed up, tell us and we will remove the account."] },
  { h: "Security and retention", body: ["Data is encrypted in transit and at rest with our providers, access is limited by row-level security, and secrets never reach the browser. We keep data while your account is active and delete it within a reasonable period after you ask."] },
  { h: "Changes", body: ["We will post material changes here and, for paying users, notify you by email."] },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
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
        Questions or requests? <Link href="/feedback" className="underline">Contact us</Link>. See also our <Link href="/terms" className="underline">Terms</Link> and <Link href="/trust" className="underline">Trust &amp; safety</Link>.
      </p>
    </main>
  );
}
