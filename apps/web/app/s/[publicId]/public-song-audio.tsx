"use client";

/**
 * Public variant of <SongAudio>. Same ADR 0012 two-tier signed-URL
 * playback, but the Tier-2 refresh endpoint is the unauthenticated
 * /api/p/[publicId]/audio-url instead of /api/songs/[id]/audio-url.
 *
 * Kept separate from the owner-page <SongAudio> on purpose -- so the
 * public surface can never accidentally hit an owner-only endpoint.
 */
import { useEffect, useRef, useState } from "react";

import { AudioSpectrogram } from "@/components/audio-spectrogram";

interface PublicSongAudioProps {
  publicId: string;
  initialUrl: string;
  durationSeconds: number | null;
  format: string;
  /** Called with the playhead (seconds) as it moves; used by the embed's synced lyrics. */
  onTime?: (seconds: number) => void;
  /** Hide the spectrogram and the footer line (compact embed). */
  minimal?: boolean;
}

export function PublicSongAudio({
  publicId,
  initialUrl,
  durationSeconds,
  format,
  onTime,
  minimal = false,
}: PublicSongAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState(initialUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSrc(initialUrl);
    setError(null);
  }, [initialUrl]);

  const counted = useRef(false);
  // Anonymous play counter for the creator's insights: once per page view, skipped when the browser says Do Not Track
  // or Global Privacy Control. Sends nothing about the listener (the server keeps only the language subtag).
  function onFirstPlay() {
    if (counted.current) return;
    counted.current = true;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    void fetch(`/api/p/${publicId}/listen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "play" }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async function onError() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/p/${publicId}/audio-url`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(`refresh failed (${res.status})`);
        return;
      }
      const payload = (await res.json()) as { url?: string };
      if (!payload.url) {
        setError("refresh returned no url");
        return;
      }
      setSrc(payload.url);
      setError(null);
      const el = audioRef.current;
      if (el) {
        el.load();
        try {
          await el.play();
        } catch {
          // User may need to click again -- autoplay policy.
        }
      }
    } catch (e) {
      setError(`refresh failed: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={src}
        onError={onError}
        onPlay={onFirstPlay}
        onTimeUpdate={onTime ? (e) => onTime(e.currentTarget.currentTime) : undefined}
        onSeeked={onTime ? (e) => onTime(e.currentTarget.currentTime) : undefined}
        crossOrigin="anonymous"
        className="w-full"
      />
      {minimal ? null : <AudioSpectrogram audioRef={audioRef} height={72} />}
      <div
        className={`items-center justify-between gap-2 text-[10px] text-foreground/60 ${minimal && !refreshing && !error ? "hidden" : "flex"}`}
      >
        <span>
          {durationSeconds ? `${durationSeconds}s · ` : ""}
          {format.toUpperCase()}
        </span>
        {refreshing ? <span>refreshing signed URL…</span> : null}
        {error ? <span className="text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
