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
import { serverI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverI18n();
  return {
    alternates: { canonical: "/feedback" },
    title: t("feedback.meta.title"),
    description: t("feedback.meta.description"),
  };
}

export default async function FeedbackPage() {
  const { t } = await serverI18n();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          {t("feedback.eyebrow")}
        </p>
        <h1 className="text-4xl font-medium tracking-tight">
          {t("feedback.title")}
        </h1>
        <p className="text-base text-foreground/60">
          {t("feedback.intro")}
        </p>
      </header>
      <FeedbackForm />
    </main>
  );
}
