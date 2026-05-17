"use client";

/**
 * Pairwise compare form. Posts the winner-track-id and loser-track-id
 * to /api/songs/[id]/compare, which calls the record_preference_pair
 * RPC. Single-vote: once submitted, the form acknowledges and offers a
 * "rate another" link back to the same page.
 */
import { useState } from "react";

type Side = { trackId: string; label: string; url: string | null };

export function CompareForm({
  jobId,
  a,
  b,
}: {
  jobId: string;
  a: Side;
  b: Side;
}) {
  const [pending, setPending] = useState<"A" | "B" | "tie" | null>(null);
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; error: string } | null>(null);

  async function vote(winner: Side, loser: Side, choice: "A" | "B" | "tie") {
    if (pending) return;
    setPending(choice);
    setOutcome(null);
    try {
      const res = await fetch(`/api/songs/${jobId}/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          winner_track_id: winner.trackId,
          loser_track_id: loser.trackId,
          choice,
        }),
      });
      if (!res.ok) {
        const text = (await res.json().catch(() => ({}))) as { error?: string };
        setOutcome({ ok: false, error: text.error ?? `HTTP ${res.status}` });
        return;
      }
      setOutcome({ ok: true });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CandidateCard side={a} disabled={!!pending} />
        <CandidateCard side={b} disabled={!!pending} />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => void vote(a, b, "A")}
          disabled={!!pending}
          className="rounded-md border border-accent/40 bg-accent/15 px-4 py-2 text-sm text-accent transition hover:bg-accent/25 disabled:opacity-40"
        >
          {pending === "A" ? "Saving…" : "A sounds better"}
        </button>
        <button
          type="button"
          onClick={() => void vote(a, b, "tie")}
          disabled={!!pending}
          className="rounded-md border border-muted/30 px-4 py-2 text-sm text-foreground/65 hover:border-accent/40 hover:text-foreground disabled:opacity-40"
        >
          {pending === "tie" ? "Saving…" : "Too close to tell"}
        </button>
        <button
          type="button"
          onClick={() => void vote(b, a, "B")}
          disabled={!!pending}
          className="rounded-md border border-accent/40 bg-accent/15 px-4 py-2 text-sm text-accent transition hover:bg-accent/25 disabled:opacity-40"
        >
          {pending === "B" ? "Saving…" : "B sounds better"}
        </button>
      </div>
      {outcome ? (
        outcome.ok ? (
          <p
            role="status"
            className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300"
          >
            Vote recorded. Thanks — this feeds the reranker.
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300"
          >
            Couldn&apos;t save vote: {outcome.error}
          </p>
        )
      ) : null}
    </section>
  );
}

function CandidateCard({ side, disabled }: { side: Side; disabled: boolean }) {
  return (
    <article className="flex flex-col gap-2 rounded-md border border-muted/30 bg-muted/5 px-4 py-3">
      <header className="flex items-center justify-between text-xs uppercase tracking-widest text-foreground/55">
        <span>{side.label}</span>
        <span className="text-foreground/40">{side.trackId.slice(0, 8)}</span>
      </header>
      {side.url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          controls
          preload="none"
          src={side.url}
          aria-disabled={disabled}
          className="w-full"
        />
      ) : (
        <p className="text-sm text-foreground/55">Audio unavailable.</p>
      )}
    </article>
  );
}
