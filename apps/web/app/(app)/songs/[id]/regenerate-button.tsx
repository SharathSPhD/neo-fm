"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

/**
 * Per-section "Regenerate" button. POSTs to
 * /api/songs/[id]/sections/[sectionId]/regenerate, then refreshes the
 * detail page so the new child job shows up under "Regen history".
 */

interface RegenerateButtonProps {
  songId: string;
  sectionId: string;
}

export function RegenerateButton({
  songId,
  sectionId,
}: RegenerateButtonProps) {
  const router = useRouter();
  const { t } = useUiLang();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setSubmittedJobId(null);
    setSubmitting(true);
    try {
      const url = `/api/songs/${encodeURIComponent(songId)}/sections/${encodeURIComponent(sectionId)}/regenerate`;
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; job_id?: string; reason?: string }
        | null;
      if (res.status === 202 && body?.job_id) {
        setSubmittedJobId(body.job_id);
        startTransition(() => {
          router.refresh();
        });
        return;
      }
      if (res.status === 409) {
        setError(t("songact.parentNotDone"));
        return;
      }
      if (res.status === 429) {
        setError(
          body?.reason === "rows_per_month"
            ? t("songact.jobQuota")
            : t("songact.quotaExceeded"),
        );
        return;
      }
      if (res.status === 404) {
        setError(t("songact.notFound"));
        return;
      }
      setError(body?.error ?? t("songact.requestFailed", { status: res.status }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={submitting || pending}
        className="rounded-md border border-accent/30 px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {submitting
          ? t("songact.submitting")
          : pending
            ? t("songact.queued")
            : submittedJobId
              ? t("songact.queued")
              : t("songact.regenerate")}
      </button>
      {submittedJobId ? (
        <span className="text-[10px] text-accent">
          {t("songact.jobQueued", { id: submittedJobId.slice(0, 8) })}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-[10px] text-red-300">
          {error}
        </span>
      ) : null}
    </div>
  );
}
