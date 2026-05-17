"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

/**
 * Cover-art panel.
 *
 * v1.3 Sprint 3: generation now flows through the DGX cover-art worker.
 * The POST returns 202 + `{ attempt_id, status: "queued" }`; this client
 * polls the GET endpoint every 2.5s until the attempt reaches a terminal
 * state. While `queued` / `processing` we show "Cover art rendering…";
 * the previous current artefact stays visible until the new one lands.
 */
type AttemptStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "dlq"
  | null;

interface CoverArtResponse {
  url: string | null;
  created_at: string | null;
  attempt: {
    attempt_id: string;
    status: AttemptStatus;
    error: string | null;
    updated_at: string;
  } | null;
}

const TERMINAL: ReadonlySet<NonNullable<AttemptStatus>> = new Set([
  "completed",
  "failed",
  "dlq",
]);

const POLL_INTERVAL_MS = 2500;

export function CoverArtPanel({ songId }: { songId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<AttemptStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [pending, startTransition] = useTransition();
  const pollHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAttemptIdRef = useRef<string | null>(null);

  const fetchState = useCallback(async (): Promise<CoverArtResponse | null> => {
    const res = await fetch(`/api/songs/${songId}/cover-art`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CoverArtResponse;
  }, [songId]);

  const applyState = useCallback((state: CoverArtResponse | null) => {
    if (!state) return;
    if (state.url) setUrl(state.url);
    const attemptStatus = state.attempt?.status ?? null;
    setStatus(attemptStatus);
    if (state.attempt) {
      lastAttemptIdRef.current = state.attempt.attempt_id;
      if (state.attempt.status === "failed" || state.attempt.status === "dlq") {
        setError(state.attempt.error ?? "Cover art generation failed.");
      } else if (state.attempt.status === "completed") {
        setError(null);
      }
    }
  }, []);

  const schedulePoll = useCallback(() => {
    if (pollHandle.current) clearTimeout(pollHandle.current);
    pollHandle.current = setTimeout(async () => {
      const state = await fetchState();
      applyState(state);
      const s = state?.attempt?.status ?? null;
      if (!s || !TERMINAL.has(s)) schedulePoll();
    }, POLL_INTERVAL_MS);
  }, [applyState, fetchState]);

  useEffect(() => {
    void (async () => {
      const state = await fetchState();
      applyState(state);
      const s = state?.attempt?.status ?? null;
      if (s && !TERMINAL.has(s)) schedulePoll();
    })();
    return () => {
      if (pollHandle.current) clearTimeout(pollHandle.current);
    };
  }, [applyState, fetchState, schedulePoll]);

  function roll() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/cover-art`, {
        method: "POST",
      });
      if (res.status === 503) {
        setDisabled(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.details ?? data.error ?? "Couldn't enqueue cover art.");
        return;
      }
      const data = (await res.json()) as {
        attempt_id: string;
        status: NonNullable<AttemptStatus>;
        prompt: string;
      };
      lastAttemptIdRef.current = data.attempt_id;
      setStatus(data.status);
      schedulePoll();
    });
  }

  const inFlight = status === "queued" || status === "processing";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        Cover art
      </h2>
      <div className="flex flex-wrap items-start gap-4">
        <div
          aria-label="Cover art preview"
          aria-busy={inFlight ? "true" : "false"}
          className="relative flex h-44 w-44 items-center justify-center overflow-hidden rounded-md border border-muted/20 bg-gradient-to-br from-accent/20 to-fuchsia-500/20 text-xs text-foreground/50"
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt="Cover art"
              className="h-full w-full rounded-md object-cover"
            />
          ) : (
            <span>No cover art yet</span>
          )}
          {inFlight ? (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 flex items-center justify-center bg-background/65 text-xs font-medium text-foreground/80 backdrop-blur-sm"
            >
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 animate-pulse rounded-full bg-accent"
                />
                Cover art rendering…
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {disabled ? (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
              Cover-art generation isn&apos;t wired on this environment yet.
              The placeholder will show on share cards until the engine is
              configured.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={roll}
                disabled={pending || inFlight}
                className="self-start rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {pending || inFlight
                  ? "Rendering…"
                  : url
                    ? "Re-roll cover art"
                    : "Generate cover art"}
              </button>
              {status && !inFlight && status !== "completed" ? (
                <p className="text-xs text-foreground/60">
                  Last attempt: {status}
                </p>
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
