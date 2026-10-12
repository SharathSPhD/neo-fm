"use client";

import { useEffect, useState } from "react";

import { AudioSpectrogram } from "@/components/audio-spectrogram";
import { formatTime } from "@/components/player/format-time";
import { usePlayer } from "@/components/player/player-provider";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

/**
 * Song-page player. A view over the app-wide player (see
 * components/player/player-provider.tsx): it registers this song's track
 * on mount, never autoplays, and playback keeps going in the mini-player
 * when the user navigates away. Signed-URL refresh (ADR 0012 tier 2) and
 * the play-fraction feedback signal live in the provider.
 */
interface SongAudioProps {
  songId: string;
  initialUrl: string;
  durationSeconds: number | null;
  format: string;
  title?: string;
  subtitle?: string;
  artworkUrl?: string | null;
}

export function SongAudio({
  songId,
  initialUrl,
  durationSeconds,
  format,
  title = "Song",
  subtitle,
  artworkUrl,
}: SongAudioProps) {
  const p = usePlayer();
  const { t } = useUiLang();
  const { load } = p;

  // Lock-screen artwork: the song's current cover, fetched lazily and
  // skipped entirely in data-saver mode (the app icon is used instead).
  const [art, setArt] = useState<string | null>(artworkUrl ?? null);
  const { dataSaver } = p;
  useEffect(() => {
    if (dataSaver || art) return;
    let cancelled = false;
    fetch(`/api/songs/${encodeURIComponent(songId)}/cover-art`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ url?: string | null }>) : null))
      .then((j) => {
        if (!cancelled && j?.url) setArt(j.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [songId, dataSaver, art]);

  useEffect(() => {
    load({
      songId,
      title,
      subtitle,
      artwork: art,
      url: initialUrl,
      durationHint: durationSeconds,
    });
  }, [load, songId, title, subtitle, art, initialUrl, durationSeconds]);

  const mine = p.track?.songId === songId;
  const duration = mine && p.duration > 0 ? p.duration : (durationSeconds ?? 0);
  const time = mine ? p.currentTime : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-full bg-muted/20 px-2 py-1.5">
        <button
          type="button"
          onClick={() => p.seekBy(-10)}
          aria-label="-10s"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-xs text-foreground/80 hover:bg-muted/30"
        >
          −10
        </button>
        <button
          type="button"
          onClick={p.toggle}
          aria-label={mine && p.playing ? t("player.pause") : t("player.play")}
          data-testid="song-play"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-background"
        >
          <span aria-hidden>{mine && p.playing ? "❚❚" : "▶"}</span>
        </button>
        <button
          type="button"
          onClick={() => p.seekBy(10)}
          aria-label="+10s"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-xs text-foreground/80 hover:bg-muted/30"
        >
          +10
        </button>
        <span className="w-10 text-right font-mono text-xs tabular-nums text-foreground/70">
          {formatTime(time)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={1}
          value={Math.min(Math.floor(time), Math.max(1, Math.floor(duration)))}
          onChange={(e) => p.seekTo(Number(e.target.value))}
          aria-label="Seek"
          className="h-11 min-w-0 flex-1 accent-[hsl(var(--accent))]"
        />
        <span className="w-10 font-mono text-xs tabular-nums text-foreground/70">
          {formatTime(duration)}
        </span>
      </div>
      {mine && p.playbackError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
        >
          <span>{t("player.error")}</span>
          <button type="button" onClick={p.retry} className="min-h-[44px] rounded-md border border-red-300/40 px-3 text-sm hover:bg-red-400/10">
            {t("player.retry")}
          </button>
        </div>
      ) : null}
      {p.dataSaver ? null : <AudioSpectrogram audioRef={p.audioRef} height={72} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/60">
        <span>
          {format.toUpperCase()}
          {durationSeconds ? ` · ${durationSeconds}s` : null}
        </span>
        <label className="flex min-h-[44px] items-center gap-2" title={t("player.dataSaverHint")}>
          <input
            type="checkbox"
            checked={p.dataSaver}
            onChange={(e) => p.setDataSaverPref(e.target.checked ? "on" : "off")}
            className="h-4 w-4 accent-[hsl(var(--accent))]"
          />
          {t("player.dataSaver")}
        </label>
        <span aria-live="polite">{p.refreshing ? t("player.reconnecting") : null}</span>
      </div>
    </div>
  );
}
