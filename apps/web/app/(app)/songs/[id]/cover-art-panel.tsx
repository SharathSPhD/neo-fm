"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

/**
 * Cover-art panel.
 *
 * v1.4 Sprint 1: default flow is the **template tier**, a deterministic
 * SVG rendered inline by `/api/songs/[id]/cover-art-template` (no queue,
 * no GPU). The button delivers a cover in well under 1 s. A separate
 * "Premium HD render" affordance reaches the diffusion tier behind
 * pgmq when `NEXT_PUBLIC_COVER_ART_PREMIUM=1` (i.e. when the operator
 * has wired the DGX cover-art-synth sidecar).
 *
 * Polling stays in place for the premium tier (the GET endpoint
 * surfaces the queued/processing/completed status of the most recent
 * attempt, regardless of tier).
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

interface TemplateResponse {
  attempt_id: string;
  cover_art_id: string | null;
  url: string | null;
  backend: "template";
  svg_size: number;
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
  const [premiumDisabled, setPremiumDisabled] = useState(false);
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

  function generateTemplate() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/cover-art-template`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.details ?? data.error ?? "Couldn't render the template cover.",
        );
        return;
      }
      const data = (await res.json()) as TemplateResponse;
      lastAttemptIdRef.current = data.attempt_id;
      setStatus("completed");
      if (data.url) setUrl(data.url);
      // Belt-and-braces: re-read /cover-art so the panel reflects the
      // freshly-flipped is_current row exactly as it appears server-side.
      void (async () => {
        const state = await fetchState();
        applyState(state);
      })();
    });
  }

  function generatePremium() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/cover-art`, {
        method: "POST",
      });
      if (res.status === 503) {
        setPremiumDisabled(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.details ?? data.error ?? "Couldn't enqueue cover art.",
        );
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
  // Premium tier is opt-in; only show it when the operator has flagged
  // the DGX cover-art-synth pipeline as wired.
  const premiumEnabled =
    process.env.NEXT_PUBLIC_COVER_ART_PREMIUM === "1" && !premiumDisabled;

  return (
    <section className="flex flex-col gap-2" data-cover-art-panel>
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
              data-cover-art-image
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
          <button
            type="button"
            onClick={generateTemplate}
            disabled={pending || inFlight}
            className="self-start rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
            data-cover-art-template
          >
            {pending && !inFlight
              ? "Rendering…"
              : url
                ? "Re-roll cover art"
                : "Generate cover art"}
          </button>
          {premiumEnabled ? (
            <button
              type="button"
              onClick={generatePremium}
              disabled={pending || inFlight}
              className="self-start rounded-md border border-muted/30 px-4 py-2 text-xs font-medium text-foreground/80 transition hover:border-accent/60 disabled:opacity-50"
              data-cover-art-premium
            >
              {inFlight ? "Premium queued…" : "Generate HD (premium)"}
            </button>
          ) : null}
          {status && !inFlight && status !== "completed" ? (
            <p className="text-xs text-foreground/60">
              Last attempt: {status}
            </p>
          ) : null}
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
