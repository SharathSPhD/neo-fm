"use client";

import { useState, useTransition } from "react";

type Stem = {
  kind: string;
  url: string;
  bytes: number | null;
  format: string;
};

export function StemsPanel({ songId }: { songId: string }) {
  const [stems, setStems] = useState<Stem[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  function load() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/stems`, {
        cache: "no-store",
      });
      if (res.status === 402) {
        setLocked(true);
        return;
      }
      if (!res.ok) {
        setError("Couldn't load stems.");
        return;
      }
      const payload = (await res.json()) as { stems: Stem[] };
      setStems(payload.stems);
    });
  }

  if (locked) {
    return (
      <section className="flex flex-col gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
        <p>
          Stem downloads are a Creator+ feature.{" "}
          <a href="/pricing" className="underline">
            Upgrade →
          </a>
        </p>
      </section>
    );
  }

  if (stems === null) {
    return (
      <button
        type="button"
        onClick={load}
        disabled={pending}
        className="self-start rounded-md border border-muted/30 px-4 py-2 text-sm text-foreground/80 hover:border-accent/40 hover:text-foreground disabled:opacity-50"
      >
        {pending ? "Loading…" : "Show stems"}
      </button>
    );
  }

  if (stems.length === 0) {
    return (
      <p className="text-xs text-foreground/50">
        Stems aren&apos;t ready yet for this song. They get rendered alongside
        the master in newer jobs; older songs only have the master mix.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-widest text-foreground/50">
        Stems (1h links)
      </h3>
      <ul className="flex flex-col gap-2">
        {stems.map((s) => (
          <li
            key={s.kind}
            className="flex items-center justify-between rounded-md border border-muted/20 bg-muted/5 px-3 py-2 text-sm"
          >
            <span className="font-medium capitalize">{s.kind}</span>
            <a
              href={s.url}
              download={`${s.kind}.${s.format}`}
              className="text-accent underline"
            >
              Download {s.format.toUpperCase()}
              {s.bytes ? ` (${formatBytes(s.bytes)})` : null}
            </a>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
