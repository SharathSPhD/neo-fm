"use client";

/**
 * Client half of the embed: audio plus the synced lyric display.
 *
 * Line timing is approximate (section targets scaled to the real audio
 * length, see lib/lyrics/sync.ts), so the display shows the current line
 * with its neighbours for context rather than pretending to word-level
 * karaoke.
 */
import { useMemo, useState } from "react";

import { activeLineIndex, buildLyricTimeline, parseLineTimings, type SyncSectionInput } from "@/lib/lyrics/sync";
import type { EmbedLayout } from "@/lib/embed/options";

import { PublicSongAudio } from "../public-song-audio";

interface Props {
  publicId: string;
  initialUrl: string;
  durationSeconds: number | null;
  format: string;
  sections: SyncSectionInput[];
  /** agent_runs.line_timings; evenly paced when absent or not matching the lyrics. */
  lineTimings?: unknown;
  layout: EmbedLayout;
  language: string;
}

export function EmbedPlayer({
  publicId,
  initialUrl,
  durationSeconds,
  format,
  sections,
  lineTimings,
  layout,
  language,
}: Props) {
  const compact = layout === "compact";
  const lines = useMemo(
    () => buildLyricTimeline(sections, durationSeconds, parseLineTimings(lineTimings)),
    [sections, durationSeconds, lineTimings],
  );
  const [t, setT] = useState(0);
  const idx = activeLineIndex(lines, t);
  const prev = idx > 0 ? lines[idx - 1] : undefined;
  const cur = idx >= 0 ? lines[idx] : undefined;
  const next = lines[idx + 1];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <PublicSongAudio
        publicId={publicId}
        initialUrl={initialUrl}
        durationSeconds={durationSeconds}
        format={format}
        onTime={lines.length ? setT : undefined}
        minimal={compact}
      />
      {lines.length > 0 ? (
        compact ? (
          <p
            lang={language}
            aria-live="off"
            className="min-h-[1.25rem] truncate text-sm text-foreground/80"
          >
            {cur?.text ?? " "}
          </p>
        ) : (
          <div
            lang={language}
            aria-live="off"
            className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 text-center"
          >
            <span className="max-w-full truncate text-xs text-foreground/50">{prev?.text ?? " "}</span>
            <span className="max-w-full text-base font-medium text-accent">
              {cur?.text ?? (idx < 0 ? "♪" : " ")}
            </span>
            <span className="max-w-full truncate text-xs text-foreground/50">
              {(idx < 0 ? lines[0]?.text : next?.text) ?? " "}
            </span>
          </div>
        )
      ) : null}
    </div>
  );
}
