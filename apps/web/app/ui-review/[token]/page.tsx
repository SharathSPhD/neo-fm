/**
 * /ui-review/[token] -- native-speaker review of the app's translated UI strings. Private link, no sign-in,
 * no personal data collected. Shows every string for the token's language next to its English source and the
 * screen it appears on; the reviewer approves it or suggests an edit.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UI_LANG_ENDONYM } from "@/lib/i18n/ui-strings";
import { buildSections } from "@/lib/ui-review/core";
import { loadMyEdits, resolveReviewer } from "@/lib/ui-review/load";

import { ReviewClient, type Verdicts } from "./review-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review translations -- neo-fm",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const LANGUAGE_NAMES = { hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", mr: "Marathi", bn: "Bengali" } as const;

export default async function UiReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reviewer = await resolveReviewer(token);
  if (!reviewer) notFound();
  const sections = buildSections(reviewer.language);
  const mine = await loadMyEdits(reviewer);
  const current = new Map(sections.flatMap((s) => s.rows.map((r) => [r.key, r.current] as const)));
  // A verdict given on an older version of the text no longer applies.
  const verdicts: Verdicts = {};
  for (const [key, e] of Object.entries(mine)) {
    if (current.get(key) === e.base_text) {
      verdicts[key] = { action: e.action, suggestion: e.suggestion ?? "", comment: e.comment ?? "" };
    }
  }
  const name = LANGUAGE_NAMES[reviewer.language];
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">
        {name} <span lang={reviewer.language}>({UI_LANG_ENDONYM[reviewer.language]})</span> translation review
      </h1>
      <p className="mt-3 max-w-2xl text-foreground/70">
        Thank you for checking how natural neo-fm sounds in {name}. For each line, compare it with the English, then press
        <strong> Looks good</strong> or fix the text and press <strong>Save my edit</strong>. Keep words like{" "}
        <code>{"{name}"}</code> and <code>[[ ]]</code> exactly as they are: the app fills those in. We store only your
        verdicts and optional comments, never your name or contact details.
      </p>
      <ReviewClient
        token={token}
        lang={reviewer.language}
        sections={sections}
        initial={verdicts}
      />
    </main>
  );
}
