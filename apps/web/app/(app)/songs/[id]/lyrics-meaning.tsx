"use client";

/**
 * Lyrics "meaning" panel: original script, romanization or an English machine translation, one line each.
 * Nothing is fetched until the listener opens the panel; the server generates the translation once per song and caches it.
 */
import { useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import type { UiKey } from "@/lib/i18n/ui-strings";

type Mode = "original" | "roman" | "english";
interface Line { section_id: string; original: string; roman: string; english: string }
interface Payload { lines: Line[] }

const MODES: { id: Mode; label: UiKey }[] = [
  { id: "original", label: "meaning.original" },
  { id: "roman", label: "meaning.roman" },
  { id: "english", label: "meaning.english" },
];

export function LyricsMeaning({ songId }: { songId: string }) {
  const { t } = useUiLang();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("english");
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "limit">("idle");

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/songs/${songId}/meaning`, { cache: "no-store" });
      if (res.status === 429) { setState("limit"); return; }
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
    <section aria-label={t("meaning.heading")} className="rounded-md border border-muted/20 bg-muted/5 px-3 py-3 sm:px-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between text-left text-[11px] uppercase tracking-widest text-foreground/60"
      >
        <span>{t("meaning.heading")}</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-3">
          <div role="radiogroup" aria-label={t("meaning.heading")} className="flex flex-wrap gap-2">
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
                {t(m.label)}
              </button>
            ))}
          </div>
          {mode === "english" ? (
            <p className="text-xs text-foreground/60" data-testid="meaning-disclaimer">
              {t("meaning.disclaimer")}
            </p>
          ) : null}
          {state === "loading" ? <p className="text-sm text-foreground/60" role="status">{t("meaning.loading")}</p> : null}
          {state === "limit" ? <p className="text-sm text-foreground/70" role="status">{t("meaning.limit")}</p> : null}
          {state === "error" ? (
            <p className="text-sm text-foreground/70" role="alert">
              {t("meaning.error")}{" "}
              <button type="button" onClick={() => void load()} className="underline">{t("meaning.retry")}</button>
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
