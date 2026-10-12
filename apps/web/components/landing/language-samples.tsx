"use client";

/**
 * Hero language switcher: five tabs, one per launch language. Each panel shows lyric lines in the language's own
 * script and, where a public community song exists, plays it. The signed audio URL is fetched on press, so the
 * landing HTML stays cacheable and no audio is downloaded until the visitor asks for it.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { HERO_LANGS, type LanguageSample } from "@/lib/landing/langs";

type PlayState = "idle" | "loading" | "playing" | "error";

export function LanguageSamples({ samples }: { samples: LanguageSample[] }) {
  const [active, setActive] = useState(0);
  const [state, setState] = useState<PlayState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
  }
  useEffect(() => () => audioRef.current?.pause(), []);

  function select(i: number) {
    if (i === active) return;
    stop();
    setActive(i);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const n = HERO_LANGS.length;
    const next = e.key === "ArrowRight" ? (active + 1) % n : e.key === "ArrowLeft" ? (active + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  }

  const meta = HERO_LANGS[active] ?? HERO_LANGS[0]!;
  const sample = samples.find((s) => s.code === meta.code);
  const song = sample?.song ?? null;

  async function toggle() {
    if (!song) return;
    if (state === "playing" || state === "loading") return stop();
    setState("loading");
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(song.publicId)}/audio-url`, { cache: "no-store" });
      const body = (await res.json()) as { url?: string };
      if (!res.ok || !body.url) throw new Error("no url");
      const el = new Audio(body.url);
      el.addEventListener("ended", () => { if (audioRef.current === el) stop(); });
      el.addEventListener("error", () => { if (audioRef.current === el) { audioRef.current = null; setState("error"); } });
      audioRef.current = el;
      await el.play();
      setState("playing");
    } catch {
      audioRef.current = null;
      setState("error");
    }
  }

  return (
    <div className="w-full max-w-3xl">
      <div role="tablist" aria-label="Hear a sample in each language" onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
        {HERO_LANGS.map((l, i) => (
          <button
            key={l.code}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            id={`lang-tab-${l.code}`}
            aria-selected={i === active}
            aria-controls="lang-panel"
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
            className={`rounded-full border px-4 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-accent ${
              i === active ? "border-accent bg-accent/15 text-accent" : "border-muted/40 text-foreground/80 hover:border-foreground/50"
            }`}
          >
            <span lang={l.code}>{l.endonym}</span> <span className="text-foreground/60">{l.name}</span>
          </button>
        ))}
      </div>

      <div id="lang-panel" role="tabpanel" aria-labelledby={`lang-tab-${meta.code}`} className="mt-4 rounded-xl border border-muted/30 bg-muted/5 p-5">
        {song ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" lang={meta.code}>{song.title}</p>
                <p className="mt-0.5 text-xs text-foreground/60">Community song · AI-generated</p>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-pressed={state === "playing"}
                className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
              >
                {state === "playing" ? "■ Stop" : state === "loading" ? "Loading…" : `▶ Hear ${meta.name}`}
              </button>
            </div>
            <p lang={meta.code} className="mt-4 whitespace-pre-line text-xl leading-relaxed sm:text-2xl">{song.lines.join("\n")}</p>
            <p role="status" className="mt-3 min-h-[1.25rem] text-xs text-foreground/60">
              {state === "error" ? "Couldn't load the audio. Open the song page to listen." : ""}
            </p>
            <Link href={`/s/${song.publicId}`} className="text-sm text-accent underline focus:outline-none focus:ring-2 focus:ring-accent">Open the full song and lyrics</Link>
          </>
        ) : (
          <>
            <p className="text-xs text-foreground/60">No community song in {meta.name} yet. Here is how you could start one:</p>
            <p lang={meta.code} className="mt-3 text-xl leading-relaxed sm:text-2xl">{sample?.idea}</p>
            <Link href="/sign-up?next=/songs/new" className="mt-4 inline-block text-sm text-accent underline focus:outline-none focus:ring-2 focus:ring-accent">Make the first {meta.name} song</Link>
          </>
        )}
      </div>
    </div>
  );
}
