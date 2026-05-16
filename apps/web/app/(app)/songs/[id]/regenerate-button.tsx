"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
        setError("Parent song isn't done generating yet. Try again once it is.");
        return;
      }
      if (res.status === 429) {
        setError(
          body?.reason === "rows_per_month"
            ? "You've hit your monthly job quota. Try next month."
            : "Quota exceeded.",
        );
        return;
      }
      if (res.status === 404) {
        setError("Couldn't find that song or section.");
        return;
      }
      setError(body?.error ?? `Request failed (${res.status}).`);
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
          ? "Submitting…"
          : pending
            ? "Queued"
            : submittedJobId
              ? "Queued"
              : "Regenerate"}
      </button>
      {submittedJobId ? (
        <span className="text-[10px] text-accent">
          Job {submittedJobId.slice(0, 8)} queued
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
