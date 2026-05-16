"use client";

/**
 * "Make a remix" button. Posts to /api/songs/[id]/remix and routes the
 * user to the new job's detail page on success. Visually mirrors the
 * sibling "Make a variation" CTA so they read as a pair.
 *
 * The button is rendered on owned songs (next to the variation CTA) and
 * also on public song pages so anyone can fork a public song they like.
 * See the wiring in `app/(app)/songs/[id]/page.tsx` and
 * `app/(marketing)/s/[publicId]/page.tsx`.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RemixButton({
  songId,
  variant = "primary",
}: {
  songId: string;
  /**
   * `primary` lights up the accent fill (use on the song detail page where
   * remix is one of two main CTAs). `subtle` flattens it to a bordered
   * button (use on public song pages where remix sits alongside Like /
   * Follow chips).
   */
  variant?: "primary" | "subtle";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/remix`, {
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/sign-in?next=/songs/${songId}`);
        return;
      }
      if (res.status === 429) {
        setError(
          "You've hit your monthly quota. Upgrade to Creator or wait for the next reset.",
        );
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data?.details ?? data?.error ?? "Couldn't kick off the remix.",
        );
        return;
      }
      const payload = (await res.json()) as { job_id: string };
      router.push(`/songs/${payload.job_id}`);
    });
  }

  const className =
    variant === "primary"
      ? "rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      : "rounded-full border border-muted/40 px-3 py-1.5 text-xs text-foreground/75 transition hover:border-accent/40 hover:text-foreground disabled:opacity-50";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={className}
      >
        {pending ? "Forking…" : "Make a remix"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
