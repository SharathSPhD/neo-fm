import type { Metadata } from "next";
import Link from "next/link";

import { PlainSummary } from "@/components/legal/summary";

export const metadata: Metadata = {
  title: "Privacy -- neo-fm",
  description: "What neo-fm collects, why, who processes it, how long we keep it, and your rights under India's DPDP Act.",
};

const SUMMARY = [
  "We collect what we need to make your songs and run your account: your email, your briefs and songs, and basic usage data. We never sell personal data and do not train models on your private songs.",
  "Your briefs and lyrics are sent to AI and hosting providers (Anthropic, Google, Supabase, Vercel, Stripe, Resend) to do their job. Some of them process data outside India.",
  "Personalisation from your likes is off unless you switch it on, and you can switch it off and wipe it at any time.",
  "You can download your data or delete your account from your account page, or write to our Grievance Officer at grievance@neo-fm.com. You must be 18 or older.",
];

const SECTIONS: { h: string; body: string[] }[] = [
  { h: "Who we are and who to contact", body: [
    "neo-fm is a product of Technektar (\"we\"). We act as the data fiduciary for the personal data described here under India's Digital Personal Data Protection Act, 2023 (DPDP Act), and apply the same principles to users everywhere.",
    "Grievance Officer, Technektar: grievance@neo-fm.com. Write to this address to exercise any right below or to complain about how we handle your data; we acknowledge within 24 hours and aim to resolve within 15 days." ] },
  { h: "What we collect", body: [
    "Account data: email address, display name or handle, optional avatar, and your sign-in method (email/password or Google). We never see your Google password.",
    "Content you create: the briefs you type, the lyrics and songs generated for you, cover art, and your library, likes and share settings. If you add a dedication, the recipient's name and your message are stored with the song and are public once the song is public.",
    "Usage and safety data: request logs, quota and spend counters, and the outcome of our automated safety checks, kept to protect the service and other users.",
    "Reports: if you report a song we keep your report (the reason and any details), the song concerned, and your account link if you were signed in. Anonymous reports carry no account link.",
    "Optional personalisation data: if you switch personalisation on, we keep your likes and other feedback signals and a taste profile built from them.",
    "Anonymous page counts: we count visits to our landing, pricing, sign-up and shared-song pages as a daily total. No cookie, IP address, device or account identifier is stored with the count, and we skip it entirely if your browser sends Do Not Track or Global Privacy Control.",
    "Payment data: handled by Stripe. We receive your plan status and a customer reference, never your card number." ] },
  { h: "Why we use it, and your consent", body: [
    "To make songs for you, run your account, enforce fair-use limits, keep the service safe, review reports, and bill paid plans. We do not sell personal data and do not use your private songs to train models.",
    "When you create an account we ask you to accept these terms and this notice; that is your consent for the uses above. Personalisation is separate and optional: it is off until you switch it on in your account, you can withdraw at any time, and \"forget me\" deletes the signals and profile. Withdrawing consent does not affect what we did before, and if you withdraw consent needed for the service, we may not be able to keep your account.",
    "Some uses do not need consent under the DPDP Act, for example complying with the law or responding to abuse and legal claims; we use your data that way only to that extent." ] },
  { h: "Who processes it", body: [
    "Anthropic (Claude) writes and reviews lyrics from your brief. Google (Gemini and Lyria) renders and checks the audio. Supabase stores data and files. Vercel hosts the app. Stripe processes payments. Resend sends our emails, such as \"your song is ready\" and moderation notices. Each receives only what it needs to do its job and is bound by its own terms with us.",
    "Several of these providers process data outside India. We do not choose to send personal data to any country the Indian government has restricted for this purpose.",
    "Your brief and lyrics are sent to these processors to produce your song; audio you share publicly is visible to anyone with its link." ] },
  { h: "Public songs and profiles", body: ["Songs you publish are public (or unlisted) and may appear on Discover and on your creator profile with your handle and avatar. Unpublish any time from the song page. Private songs are only visible to you."] },
  { h: "How long we keep it", body: [
    "Account, songs and files: for as long as your account is active.",
    "When you delete your account: we cancel any subscription, delete your Stripe customer record, and delete your songs (including published ones), audio, cover art, feedback and profile from our live systems. Copies in provider backups disappear when those backups expire. Stripe and our tax records keep invoices for as long as the law requires.",
    "Reports and decisions about songs are kept while we need them to handle appeals and repeat abuse; if a reported song is deleted, its reports go with it, and if a reporter deletes their account the link to them is removed.",
    "Operational logs are kept for a limited period for security and debugging. Anonymous page counts are daily totals and contain no personal data." ] },
  { h: "Your rights", body: [
    "You can ask for a summary of the data we hold, correct or complete it, erase it, withdraw consent, have a grievance addressed, and nominate someone to exercise these rights for you if you die or cannot act.",
    "Fastest routes: Export my data and Delete account on your account page, and the personalisation switch there. For anything else, or for correction requests, write to grievance@neo-fm.com. If we have not resolved your grievance, you may complain to the Data Protection Board of India once it is operating.",
    "We can provide this notice in English or any language listed in the Eighth Schedule to the Constitution on request." ] },
  { h: "Children", body: ["neo-fm is only for people 18 or older, and we ask you to confirm this when you sign up. We do not knowingly collect data from children or track or target them; if you believe a child has signed up, tell us at grievance@neo-fm.com and we will delete the account."] },
  { h: "Cookies and similar storage", body: ["We use cookies that keep you signed in and small browser storage for settings such as theme and language, onboarding progress and counting a page once per tab. We do not use advertising or cross-site tracking cookies."] },
  { h: "Security and incidents", body: ["Data is encrypted in transit and at rest with our providers, access is limited by row-level security, and secrets never reach the browser. If a breach affects your personal data we will tell you and the Data Protection Board as the law requires."] },
  { h: "Changes", body: ["We will post material changes here and, for paying users, notify you by email."] },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
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
        Questions or requests? <Link href="/feedback" className="underline">Contact us</Link> or write to <a className="underline" href="mailto:grievance@neo-fm.com">grievance@neo-fm.com</a>. See also our <Link href="/terms" className="underline">Terms</Link>, <Link href="/content-policy" className="underline">Content policy</Link> and <Link href="/trust" className="underline">Trust &amp; safety</Link>.
      </p>
    </main>
  );
}
