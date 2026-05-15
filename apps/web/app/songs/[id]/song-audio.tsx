"use client";

import { useEffect, useRef, useState } from "react";

/**
 * SongAudio component.
 *
 * Renders the `<audio>` element for a song's latest track. Implements
 * the **Tier 2** half of ADR 0012's signed-URL playback strategy: when
 * the `<audio>` element fires an error (typically because the signed
 * URL has expired mid-session), we fetch a fresh URL from
 * `GET /api/songs/[id]/audio-url` and swap the src in place.
 *
 * No page reload, no jarring UX. Tier 1 (the initial URL embedded in
 * the server-rendered page) is provided by the parent as `initialUrl`.
 */

interface SongAudioProps {
  songId: string;
  initialUrl: string;
  durationSeconds: number | null;
  format: string;
}

export function SongAudio({
  songId,
  initialUrl,
  durationSeconds,
  format,
}: SongAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState(initialUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Track whether the user is mid-playback so we can resume after a
  // refresh swap without surprising them.
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    setSrc(initialUrl);
  }, [initialUrl]);

  async function onError() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    wasPlayingRef.current = audioRef.current
      ? !audioRef.current.paused
      : false;
    try {
      const res = await fetch(
        `/api/songs/${encodeURIComponent(songId)}/audio-url`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { url: string };
      setSrc(body.url);
      // Give React a tick to swap the src attribute before we ask
      // the element to load the new resource.
      requestAnimationFrame(() => {
        const el = audioRef.current;
        if (!el) return;
        el.load();
        if (wasPlayingRef.current) {
          void el.play().catch(() => {
            // Autoplay policies may block the resume; that's fine,
            // the user can click play themselves on the refreshed src.
          });
        }
      });
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={src}
        onError={onError}
        className="w-full"
      />
      <div className="flex items-center justify-between text-[10px] text-foreground/40">
        <span>
          {format.toUpperCase()}
          {durationSeconds ? ` · ${durationSeconds}s` : null}
        </span>
        <span aria-live="polite">
          {refreshing
            ? "Refreshing signed URL…"
            : refreshError
              ? `Couldn't refresh: ${refreshError}`
              : null}
        </span>
      </div>
    </div>
  );
}
