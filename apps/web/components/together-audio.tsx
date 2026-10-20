"use client";

import { useEffect, useRef, useState } from "react";

import { togetherOffset } from "@/lib/station/together";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The player on a shared track page. When the link came from "listen together" (it carries the sender's playhead), it
 * offers to join at the same point; the offset is recomputed at the tap so it is exact. Anything else is a plain player.
 */
export function TogetherAudio({ src, durationSeconds }: { src: string; durationSeconds: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    setOffset(togetherOffset(location.search, Date.now(), durationSeconds));
  }, [durationSeconds]);

  function join() {
    const audio = audioRef.current;
    if (!audio) return;
    const at = togetherOffset(location.search, Date.now(), durationSeconds ?? (Number.isFinite(audio.duration) ? audio.duration : null));
    if (at !== null) audio.currentTime = at;
    setJoined(true);
    void audio.play().catch(() => { /* the controls are right there */ });
  }

  return (
    <div className="flex flex-col gap-3">
      {offset !== null && !joined ? (
        <div className="flex flex-wrap items-center gap-3 rounded border px-4 py-3">
          <p className="text-sm">A friend is listening to this right now, {mmss(offset)} in.</p>
          <button type="button" onClick={join} className="rounded bg-accent px-4 py-2 text-background">
            Listen together
          </button>
        </div>
      ) : null}
      {joined ? <p className="text-sm text-foreground/70">You are listening together.</p> : null}
      <audio ref={audioRef} controls preload="metadata" src={src} className="w-full" />
    </div>
  );
}
