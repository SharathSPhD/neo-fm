"use client";

/**
 * First-run guided creation: language -> idea -> (optional) hear the mood.
 *
 * Shown above the describe form until the user has made a song. Picking a
 * language also switches the UI language for the key flows. The mood
 * preview is synthesised in the browser and labelled as such.
 */
import { useEffect, useRef, useState } from "react";

import { EXAMPLE_IDEAS, GUIDE_LANGS } from "@/lib/first-run/examples";
import { playMood, type MoodPlayback } from "@/lib/audio/mood-preview";
import { UI_LANG_ENDONYM, type UiLang } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function FirstRunGuide({
  language,
  onPickLanguage,
  onPickIdea,
  onSkip,
}: {
  language: UiLang;
  onPickLanguage(lang: UiLang): void;
  onPickIdea(prompt: string): void;
  onSkip(): void;
}) {
  const { setLang, t } = useUiLang();
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const playback = useRef<MoodPlayback | null>(null);

  function stop() {
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
  }

  useEffect(() => () => playback.current?.stop(), []);

  function pickLanguage(lang: UiLang) {
    stop();
    setPicked(null);
    setLang(lang);
    onPickLanguage(lang);
  }

  function toggleMood() {
    if (playing) return stop();
    const p = playMood(language);
    if (!p) return;
    playback.current = p;
    setPlaying(true);
    void p.done.then(() => {
      if (playback.current === p) {
        playback.current = null;
        setPlaying(false);
      }
    });
  }

  const ideas = EXAMPLE_IDEAS[language];

  return (
    <section
      aria-labelledby="first-run-title"
      data-testid="first-run-guide"
      className="flex flex-col gap-5 rounded-xl border border-accent/30 bg-accent/5 p-4 sm:p-6"
    >
      <header className="flex flex-col gap-1">
        <h2 id="first-run-title" className="text-xl font-medium tracking-tight">
          {t("guide.title")}
        </h2>
        <p className="text-sm text-foreground/70">{t("guide.subtitle")}</p>
      </header>

      <div className="flex flex-col gap-2">
        <p
          id="first-run-lang-label"
          className="text-xs uppercase tracking-widest text-foreground/60"
        >
          {t("guide.language")}
        </p>
        <div
          role="radiogroup"
          aria-labelledby="first-run-lang-label"
          className="flex flex-wrap gap-2"
        >
          {GUIDE_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === language}
              lang={l}
              onClick={() => pickLanguage(l)}
              className={[
                "min-h-[44px] rounded-full border px-4 py-2 text-base transition",
                l === language
                  ? "border-accent bg-accent/20 text-foreground"
                  : "border-muted/40 text-foreground/80 hover:border-foreground/40",
              ].join(" ")}
            >
              {UI_LANG_ENDONYM[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p
          id="first-run-ideas-label"
          className="text-xs uppercase tracking-widest text-foreground/60"
        >
          {t("guide.ideas")}
        </p>
        <ul aria-labelledby="first-run-ideas-label" className="flex flex-col gap-2">
          {ideas.map((idea, i) => (
            <li key={`${language}-${i}`}>
              <button
                type="button"
                lang={language}
                aria-pressed={picked === i}
                data-testid="first-run-idea"
                onClick={() => {
                  setPicked(i);
                  onPickIdea(idea);
                }}
                className={[
                  "min-h-[44px] w-full rounded-lg border px-4 py-3 text-left text-base leading-snug transition",
                  picked === i
                    ? "border-accent bg-accent/15"
                    : "border-muted/40 hover:border-foreground/40 hover:bg-muted/10",
                ].join(" ")}
              >
                {idea}
              </button>
            </li>
          ))}
        </ul>
        <p role="status" className="min-h-[1.25rem] text-sm text-accent">
          {picked !== null ? t("guide.picked") : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleMood}
          aria-pressed={playing}
          data-testid="first-run-hear"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20"
        >
          <span aria-hidden>{playing ? "■" : "▶"}</span>
          {playing ? t("guide.stop") : t("guide.hear")}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="min-h-[44px] px-2 text-sm text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("guide.skip")}
        </button>
      </div>
      <p className="-mt-2 text-xs text-foreground/60">{t("guide.sampleNote")}</p>
    </section>
  );
}
