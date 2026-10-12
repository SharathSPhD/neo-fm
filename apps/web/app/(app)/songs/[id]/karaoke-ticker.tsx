"use client";

/**
 * Synced lyrics panel.
 *
 * We only have section-level timing from the renderer, so each section's
 * time is shared out across its lines by length (see lib/lyrics/sync.ts)
 * and scaled to the real track length. The active line is highlighted and
 * kept centred inside the panel; tapping a line seeks the audio there.
 *
 * Listens to the first <audio> in the document (SongAudio mounts it just
 * above). Auto-scroll pauses for a few seconds after the user scrolls by
 * hand and never moves the page itself, only the panel.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import {
  activeLineIndex,
  buildLyricTimeline,
  type SyncSectionInput,
} from "@/lib/lyrics/sync";

const USER_SCROLL_HOLD_MS = 4000;

export function KaraokeTicker({
  sections,
  durationSeconds,
}: {
  sections: SyncSectionInput[];
  durationSeconds?: number | null;
}) {
  const { t } = useUiLang();
  const [audioSeconds, setAudioSeconds] = useState<number | null>(
    durationSeconds ?? null,
  );
  const lines = useMemo(
    () => buildLyricTimeline(sections, audioSeconds),
    [sections, audioSeconds],
  );
  const [active, setActive] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const holdUntil = useRef(0);

  useEffect(() => {
    const audio = document.querySelector<HTMLAudioElement>("audio");
    if (!audio) return;
    let raf = 0;
    const sync = () => setActive(activeLineIndex(lines, audio.currentTime));
    const loop = () => {
      sync();
      if (!audio.paused && !audio.ended) raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setAudioSeconds(audio.duration);
      }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("seeked", sync);
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("loadedmetadata", onMeta);
    onMeta();
    sync();
    if (!audio.paused) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("seeked", sync);
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [lines]);

  useEffect(() => {
    const panel = panelRef.current;
    const el = lineRefs.current[active];
    if (!autoScroll || !panel || !el || Date.now() < holdUntil.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollTo({
      top: el.offsetTop - panel.clientHeight / 2 + el.clientHeight / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active, autoScroll]);

  function seek(start: number) {
    const audio = document.querySelector<HTMLAudioElement>("audio");
    if (!audio) return;
    holdUntil.current = 0;
    audio.currentTime = start;
    void audio.play().catch(() => undefined);
  }

  if (lines.length === 0) return null;

  return (
    <section
      aria-label={t("lyrics.heading")}
      className="rounded-md border border-muted/20 bg-muted/5 px-3 py-3 sm:px-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[11px] uppercase tracking-widest text-foreground/60">
            {t("lyrics.heading")}
          </h3>
          <p className="text-xs text-foreground/60">{t("lyrics.hint")}</p>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-xs text-foreground/70">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-4 w-4 accent-[hsl(var(--accent))]"
          />
          {t("lyrics.autoscroll")}
        </label>
      </div>
      <div
        ref={panelRef}
        // Scrollable regions must be keyboard reachable (axe: scrollable-region-focusable).
        tabIndex={0}
        onWheel={() => (holdUntil.current = Date.now() + USER_SCROLL_HOLD_MS)}
        onTouchMove={() => (holdUntil.current = Date.now() + USER_SCROLL_HOLD_MS)}
        className="relative max-h-72 overflow-y-auto scroll-smooth rounded-md py-6 text-base leading-relaxed sm:max-h-80 sm:text-lg"
        data-testid="lyrics-panel"
      >
        <ol className="flex flex-col">
          {lines.map((l, i) => (
            <li key={l.key}>
              {l.lineInSection === 0 ? (
                <span className="mt-3 block px-3 text-[10px] uppercase tracking-widest text-foreground/50 first:mt-0">
                  {l.sectionType.replace(/_/g, " ")}
                </span>
              ) : null}
              <button
                type="button"
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={() => seek(l.start)}
                aria-current={i === active ? "true" : undefined}
                className={[
                  "block min-h-[44px] w-full rounded px-3 py-1.5 text-left transition-colors",
                  i === active
                    ? "bg-accent/15 font-medium text-foreground"
                    : i < active
                      ? "text-foreground/60 hover:text-foreground"
                      : "text-foreground/75 hover:text-foreground",
                ].join(" ")}
              >
                {l.text}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
