"use client";

import { useEffect, useState, useTransition } from "react";

/**
 * AI cover-art panel (Sprint H wow #3). Lets the owner generate
 * (and re-roll) cover art via the Hugging Face Z-Image-Turbo
 * model. The actual generation is server-side at
 * /api/songs/[id]/cover-art; this client island just polls + draws.
 *
 * If the server returns 503 (`HUGGINGFACE_API_TOKEN` not set), the
 * panel shows a friendly placeholder and a hint.
 */
export function CoverArtPanel({ songId }: { songId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/songs/${songId}/cover-art`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { url: string | null };
      if (data.url) setUrl(data.url);
    })();
  }, [songId]);

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
        setError(data.details ?? "Couldn't render cover art.");
        return;
      }
      const data = (await res.json()) as { url: string | null };
      setUrl(data.url);
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        Cover art
      </h2>
      <div className="flex flex-wrap items-start gap-4">
        <div
          aria-label="Cover art preview"
          className="flex h-44 w-44 items-center justify-center rounded-md border border-muted/20 bg-gradient-to-br from-accent/20 to-fuchsia-500/20 text-xs text-foreground/50"
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
        </div>
        <div className="flex flex-col gap-2">
          {disabled ? (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
              Cover-art generation isn&apos;t wired on this environment yet
              (HF token missing). The placeholder will show on share cards
              until the token is configured.
            </p>
          ) : (
            <button
              type="button"
              onClick={roll}
              disabled={pending}
              className="self-start rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              {pending ? "Rendering…" : url ? "Re-roll cover art" : "Generate cover art"}
            </button>
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
