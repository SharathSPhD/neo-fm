"use client";

/**
 * Karaoke ticker -- highlights the current section's lyrics in time
 * with the playing <audio>. We don't have phoneme-level timestamps
 * yet, so the granularity is "current section" based on
 * cumulative `target_seconds`. Good enough for the 30-90s songs the
 * v1.1 model produces.
 *
 * Mounts above the audio element. Listens to `timeupdate` on the
 * first <audio> in the document; lazy and small. When the user
 * scrubs, we update in lockstep.
 */
import { useEffect, useState } from "react";

type Section = {
  id: string;
  type: string;
  target_seconds: number;
  lyrics?: string;
};

export function KaraokeTicker({ sections }: { sections: Section[] }) {
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    const audio = document.querySelector<HTMLAudioElement>("audio");
    if (!audio) return;
    const bounds = computeBounds(sections);
    function onTime() {
      if (!audio) return;
      const t = audio.currentTime;
      for (let i = 0; i < bounds.length; i++) {
        const b = bounds[i];
        if (b && t < b.end) {
          setCurrentIdx(i);
          return;
        }
      }
      setCurrentIdx(Math.max(0, bounds.length - 1));
    }
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("seeked", onTime);
    onTime();
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("seeked", onTime);
    };
  }, [sections]);

  const visibleSections = sections.filter((s) => !!s.lyrics?.trim());
  if (visibleSections.length === 0) return null;

  return (
    <section
      aria-label="Lyrics ticker"
      className="rounded-md border border-muted/20 bg-muted/5 px-4 py-3"
    >
      <p className="mb-2 text-[10px] uppercase tracking-widest text-foreground/40">
        Lyrics (tracking playback)
      </p>
      <ol className="flex flex-col gap-2 text-sm leading-relaxed">
        {sections.map((s, i) => {
          if (!s.lyrics?.trim()) return null;
          const active = i === currentIdx;
          return (
            <li
              key={s.id}
              className={
                active
                  ? "rounded bg-accent/10 px-3 py-2 text-foreground transition"
                  : "px-3 py-2 text-foreground/40 transition"
              }
            >
              <span className="block text-[10px] uppercase tracking-widest text-foreground/40">
                {s.type}
              </span>
              <span className="whitespace-pre-wrap">{s.lyrics}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function computeBounds(sections: Section[]) {
  let cursor = 0;
  return sections.map((s) => {
    const start = cursor;
    cursor += s.target_seconds;
    return { id: s.id, start, end: cursor };
  });
}
