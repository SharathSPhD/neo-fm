"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import { clearMediaSession, setMediaHandlers, setMediaMetadata, setMediaPlaybackState } from "@/lib/player/media-session";

interface Track {
  id: string;
  title: string;
  language: string;
  tags: string[];
  url: string;
}

type Kind = "play" | "like" | "skip" | "replay" | "share" | "finish";

/** After this many tracks in a row fail to load, stop skipping and tell the listener instead of looping. */
const MAX_CONSECUTIVE_ERRORS = 3;

const LANGS = ["", "hi", "ta", "te", "kn", "bn"] as const;

function sendSignal(trackId: string, kind: Kind, audio: HTMLAudioElement | null) {
  void fetch("/api/station/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ trackId, kind, positionMs: audio ? Math.round(audio.currentTime * 1000) : undefined }),
  });
}

export function StationPlayer() {
  const globalPlayer = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [lang, setLang] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const errorsInARow = useRef(0);
  const current = queue[0] ?? null;

  const refill = useCallback(async (language: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/station/queue?limit=10${language ? `&lang=${language}` : ""}`);
      const data = (await res.json()) as { tracks?: Track[] };
      setQueue(data.tracks ?? []);
    } catch {
      setQueue([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refill(lang); }, [lang, refill]);

  // Start playback when the head of the queue changes; stop the app-wide player so two songs never overlap.
  useEffect(() => {
    if (!current || !audioRef.current) return;
    globalPlayer.close();
    audioRef.current.src = current.url;
    setBlocked(false);
    // Mobile browsers can refuse autoplay after a language change; show a tap target instead of silence.
    void audioRef.current.play().then(() => sendSignal(current.id, "play", null)).catch(() => setBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the head track id should restart playback
  }, [current?.id]);

  function advance(kind: "skip" | "finish" | "error") {
    if (!current) return;
    if (kind !== "error") sendSignal(current.id, kind, audioRef.current);
    if (queue.length <= 2) {
      // Refill from the server so the tail reflects what was just skipped or finished.
      void refill(lang);
    } else {
      setQueue((q) => q.slice(1));
    }
  }

  function onTrackError() {
    errorsInARow.current += 1;
    if (errorsInARow.current >= MAX_CONSECUTIVE_ERRORS) {
      setFailed(true);
      return;
    }
    advance("error");
  }

  // Lock-screen and headset controls; handlers read the latest closure through a ref so they never go stale.
  const controls = useRef({ skip: () => {} });
  controls.current.skip = () => advance("skip");
  useEffect(() => {
    if (!current) return;
    setMediaMetadata({ title: current.title, artist: "neo-fm Station" });
    setMediaHandlers({
      play: () => void audioRef.current?.play(),
      pause: () => audioRef.current?.pause(),
      stop: () => audioRef.current?.pause(),
      seekBy: (d) => { if (audioRef.current) audioRef.current.currentTime += d; },
      seekTo: (t) => { if (audioRef.current) audioRef.current.currentTime = t; },
      next: () => controls.current.skip(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metadata follows the head track only
  }, [current?.id]);
  useEffect(() => clearMediaSession, []);

  function retry() {
    errorsInARow.current = 0;
    setFailed(false);
    void refill(lang);
  }

  function like() {
    if (!current || liked.has(current.id)) return;
    setLiked(new Set(liked).add(current.id));
    sendSignal(current.id, "like", audioRef.current);
  }

  function replay() {
    if (!current || !audioRef.current) return;
    sendSignal(current.id, "replay", audioRef.current);
    audioRef.current.currentTime = 0;
    void audioRef.current.play();
  }

  async function share() {
    if (!current) return;
    const text = `${current.title} on neo-fm Station`;
    const url = `${location.origin}/station`;
    try {
      if (navigator.share) await navigator.share({ title: current.title, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setNote("Link copied"); }
      sendSignal(current.id, "share", audioRef.current);
    } catch { /* share sheet dismissed */ }
  }

  return (
    <section aria-label="Station player" className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Language">
        {LANGS.map((l) => (
          <button
            key={l || "all"}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`rounded-full border px-3 py-1 text-sm ${lang === l ? "bg-primary text-primary-foreground" : ""}`}
          >
            {l || "All"}
          </button>
        ))}
      </div>

      {loading && !current ? <p>Loading…</p> : null}
      {!loading && !current ? <p>Nothing to play yet. Check back soon.</p> : null}

      {current ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <p className="text-lg font-medium">{current.title}</p>
          <p className="text-xs text-muted-foreground">{current.language} · {current.tags.slice(0, 4).join(", ")}</p>
          <audio
            ref={audioRef}
            controls
            className="w-full"
            onEnded={() => advance("finish")}
            onPlaying={() => { errorsInARow.current = 0; setBlocked(false); setMediaPlaybackState(true); }}
            onPause={() => setMediaPlaybackState(false)}
            onError={onTrackError}
          />
          {queue[1] ? <audio key={queue[1].id} src={queue[1].url} preload="auto" hidden aria-hidden="true" /> : null}
          {blocked ? (
            <button type="button" onClick={() => void audioRef.current?.play()} className="rounded bg-primary px-3 py-2 text-primary-foreground">
              Tap to play
            </button>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm">
              Songs are not loading right now. <button type="button" onClick={retry} className="underline">Try again</button>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={like} aria-pressed={liked.has(current.id)} className="rounded border px-3 py-2">
              {liked.has(current.id) ? "Liked" : "Like"}
            </button>
            <button type="button" onClick={replay} className="rounded border px-3 py-2">Replay</button>
            <button type="button" onClick={() => advance("skip")} className="rounded border px-3 py-2">Skip</button>
            <button type="button" onClick={share} className="rounded border px-3 py-2">Share</button>
          </div>
          {note ? <p role="status" className="text-sm">{note}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
