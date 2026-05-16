"use client";

/**
 * Compact "Recover" affordance. Used by the library row and the song
 * detail page when a job is stuck (completed-orphan / failed). Calls
 * `POST /api/songs/[id]/recover`, then refreshes the route so the user
 * sees status=queued.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RecoverButton({
  songId,
  label = "Recover",
  className = "",
}: {
  songId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/songs/${songId}/recover`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        const msg =
          payload.details && typeof payload.details === "string"
            ? payload.details
            : payload.error ?? `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {busy ? "Re-queuing…" : label}
      </button>
      {error ? (
        <span role="alert" className="text-[10px] text-red-300">
          {error}
        </span>
      ) : null}
    </span>
  );
}
