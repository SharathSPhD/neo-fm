/**
 * /feedback -- user-feedback form (Sprint E).
 *
 * Anonymous-safe. Posts to /api/feedback which wraps the
 * `submit_feedback` RPC (migration 0021). We keep the form
 * dead simple (subject + body) so even people on bad networks
 * can leave a note.
 */
import type { Metadata } from "next";

import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = {
  title: "Send feedback -- neo-fm",
  description: "Tell us what's working, what isn't, and what to build next.",
};

export default function FeedbackPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          feedback
        </p>
        <h1 className="text-4xl font-medium tracking-tight">
          Tell us what&apos;s on your mind.
        </h1>
        <p className="text-base text-foreground/60">
          Bug reports, feature wishes, songs we should support, raga
          requests -- everything lands in our inbox. We read every note.
        </p>
      </header>
      <FeedbackForm />
    </main>
  );
}
