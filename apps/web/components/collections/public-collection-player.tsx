"use client";

/**
 * Sequential player for a shared collection (/c/[publicId]). Outside the
 * authed app there is no global player, so this owns one <audio> element:
 * each song's signed URL is minted just before it plays (public endpoint,
 * published songs only) and the next one starts when a song ends.
 */
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

export interface PublicCollectionSong {
  publicId: string;
  title: string;
  subtitle?: string;
}

export function PublicCollectionPlayer({ songs }: { songs: PublicCollectionSong[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (i: number): Promise<void> => {
      const song = songs[i];
      const el = audioRef.current;
      if (!song || !el) return;
      setIndex(i);
      setError(null);
      try {
        const res = await fetch(`/api/p/${encodeURIComponent(song.publicId)}/audio-url`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const { url } = (await res.json()) as { url: string };
        el.src = url;
        await el.play();
      } catch {
        // Skip an unavailable song rather than stalling the playlist.
        if (i + 1 < songs.length) void start(i + 1);
        else setError("This song can't be played right now.");
      }
    },
    [songs],
  );

  if (songs.length === 0) {
    return <p className="text-sm text-foreground/60">No playable songs in this collection yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => {
          const el = audioRef.current;
          if (index !== null && el) {
            if (el.paused) void el.play().catch(() => undefined);
            else el.pause();
          } else void start(0);
        }}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-accent px-5 py-2 text-background"
      >
        <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        {index === null ? "Play all" : playing ? "Pause" : "Resume"}
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        controls={index !== null}
        className={index === null ? "hidden" : "w-full"}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          if (index !== null && index + 1 < songs.length) void start(index + 1);
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <ol className="flex flex-col divide-y divide-muted/20 rounded-xl border border-muted/30">
        {songs.map((s, i) => (
          <li key={s.publicId} className="flex items-center gap-3 px-3 py-2">
            <button
              type="button"
              onClick={() => void start(i)}
              aria-label={`Play ${s.title}`}
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-muted/50"
            >
              <span aria-hidden>{index === i && playing ? "❚❚" : "▶"}</span>
            </button>
            <Link href={`/s/${s.publicId}`} className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${index === i ? "text-accent" : ""}`}>
                {i + 1}. {s.title}
              </span>
              {s.subtitle ? (
                <span className="block truncate text-xs text-foreground/55">{s.subtitle}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
