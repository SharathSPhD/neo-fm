"use client";

/**
 * Lyrics "meaning" panel: original script, romanization or an English machine translation, one line each.
 * Nothing is fetched until the listener opens the panel; the server generates the translation once per song and caches it.
 */
import { useState } from "react";

type Mode = "original" | "roman" | "english";
interface Line { section_id: string; original: string; roman: string; english: string }
interface Payload { lines: Line[]; disclaimer: string }

const MODES: { id: Mode; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "roman", label: "Romanised" },
  { id: "english", label: "English meaning" },
];

export function LyricsMeaning({ songId }: { songId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("english");
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/songs/${songId}/meaning`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Payload);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && state !== "loading") void load();
  }

  return (
    <section aria-label="Lyrics meaning" className="rounded-md border border-muted/20 bg-muted/5 px-3 py-3 sm:px-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between text-left text-[11px] uppercase tracking-widest text-foreground/60"
      >
        <span>Lyrics meaning</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-3">
          <div role="radiogroup" aria-label="Lyrics view" className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={[
                  "min-h-[44px] rounded-full border px-3 text-xs",
                  mode === m.id ? "border-accent bg-accent/15 text-foreground" : "border-muted/30 text-foreground/70 hover:text-foreground",
                ].join(" ")}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === "english" ? (
            <p className="text-xs text-foreground/60" data-testid="meaning-disclaimer">
              {data?.disclaimer ?? "English meaning is an AI machine translation. It conveys the sense, not the poetry, and may miss cultural nuance."}
            </p>
          ) : null}
          {state === "loading" ? <p className="text-sm text-foreground/60" role="status">Preparing the meaning…</p> : null}
          {state === "error" ? (
            <p className="text-sm text-foreground/70" role="alert">
              Couldn&apos;t load the meaning right now.{" "}
              <button type="button" onClick={() => void load()} className="underline">Try again</button>
            </p>
          ) : null}
          {data ? (
            <ol className="flex flex-col gap-1.5 text-base leading-relaxed" data-testid="meaning-lines">
              {data.lines.map((l, i) => (
                <li key={`${l.section_id}:${i}`}>{mode === "original" ? l.original : mode === "roman" ? l.roman : l.english}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
