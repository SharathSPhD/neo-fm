import type { Metadata } from "next";
import Link from "next/link";

import { GRIEVANCE_SLA, LEGAL_CONTACT } from "@/lib/legal/contact";

export const metadata: Metadata = {
  alternates: { canonical: "/grievance" },
  title: "Complaints and takedowns -- neo-fm",
  description: "How to report a song, request removal, or reach our Grievance Officer, and how fast we respond.",
};

export default function GrievancePage() {
  const c = LEGAL_CONTACT;
  const s = GRIEVANCE_SLA;
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Complaints and takedowns</h1>
      <p className="mt-3 text-sm text-foreground/60">Last updated: October 2026</p>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Report a song</h2>
        <p className="mt-2 text-foreground/70">
          Open the song and choose <strong>Report</strong>. Pick the reason: impersonates a real person or artist, hateful or harassing, sexual content or involves minors, copies someone&apos;s work, or something else. A reviewer looks at every report.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">What we do and how fast</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-foreground/70">
          <li>We acknowledge a complaint within {s.acknowledgeHours} hours and resolve it within {s.resolveDays} days.</li>
          <li>Content that shows a person in nudity or a sexual act without consent, or that impersonates a person through AI, is removed within {s.urgentRemovalHours} hours of a complaint. We act sooner on a court order or a direction from a government authority.</li>
          <li>We may hide a reported song while we review it. We tell the person who published it why, and they can reply.</li>
          <li>Repeat or serious breaches lead to account suspension.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Copyright and personality-rights claims</h2>
        <p className="mt-2 text-foreground/70">
          Write to the Grievance Officer with the song link, what you own or which person you are, why the song infringes, and your contact details. If you act for someone else, say so. We remove or disable the song where the claim is reasonable and tell you what we did.
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-muted/30 p-5" aria-labelledby="officer-heading">
        <h2 id="officer-heading" className="text-lg font-medium">Grievance Officer</h2>
        <p className="mt-2 text-sm text-foreground/70">
          Under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.
        </p>
        <dl className="mt-3 space-y-1 text-sm text-foreground/80">
          <div><dt className="inline font-medium">Officer: </dt><dd className="inline">{c.grievanceOfficerName || "Grievance Officer"}, {c.entity}</dd></div>
          <div><dt className="inline font-medium">Email: </dt><dd className="inline"><a className="underline" href={`mailto:${c.email}`}>{c.email}</a></dd></div>
          <div><dt className="inline font-medium">Operator: </dt><dd className="inline"><a className="underline" href={c.website} rel="noopener">{c.entity}, {c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></dd></div>
          {c.address ? <div><dt className="inline font-medium">Address: </dt><dd className="inline">{c.address}</dd></div> : null}
        </dl>
        <p className="mt-3 text-xs text-foreground/60">
          For data rights under the DPDP Act (access, correction, erasure), write to the same address with &ldquo;Data request&rdquo; in the subject. If we do not resolve a complaint you may approach the relevant authority, such as the Data Protection Board of India for personal data matters.
        </p>
      </section>

      <p className="mt-12 text-sm text-foreground/60">
        See also <Link href="/terms" className="underline">Terms</Link>, <Link href="/privacy" className="underline">Privacy</Link>, <Link href="/ai-disclosure" className="underline">AI disclosure</Link> and <Link href="/trust" className="underline">Trust &amp; safety</Link>.
      </p>
    </main>
  );
}
