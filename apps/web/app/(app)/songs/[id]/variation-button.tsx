"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function VariationButton({ songId }: { songId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/variation`, {
        method: "POST",
      });
      if (res.status === 429) {
        setError("You've hit your monthly quota. Free tier is 3 songs / month.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.details ?? "Couldn't kick off the variation.");
        return;
      }
      const payload = (await res.json()) as { job_id: string };
      router.push(`/songs/${payload.job_id}`);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Generating…" : "Make a variation"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
