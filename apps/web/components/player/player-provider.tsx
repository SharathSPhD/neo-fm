"use client";

/**
 * App-wide audio player.
 *
 * One <audio> element lives in the authed layout, so playback survives
 * client-side navigation; <SongAudio> on a song page and <MiniPlayer>
 * elsewhere are both just views over it. Also owns the signed-URL
 * refresh (ADR 0012 tier 2), the play-fraction feedback signal, Media
 * Session lock-screen controls and the data-saver preference.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  isDataSaverActive,
  parsePref,
  readConnectionHints,
  type DataSaverPref,
} from "@/lib/player/bandwidth";
import {
  clearMediaSession,
  setMediaHandlers,
  setMediaMetadata,
  setMediaPlaybackState,
  setMediaPosition,
} from "@/lib/player/media-session";

export interface PlayerTrack {
  songId: string;
  title: string;
  subtitle?: string;
  artwork?: string | null;
  url: string;
  durationHint?: number | null;
}

interface PlayerContextValue {
  track: PlayerTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  refreshing: boolean;
  refreshError: string | null;
  /** Set once automatic recovery has given up; cleared by retry() or a new track. */
  playbackError: boolean;
  retry(): void;
  dataSaver: boolean;
  dataSaverPref: DataSaverPref;
  setDataSaverPref(p: DataSaverPref): void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  load(track: PlayerTrack): void;
  toggle(): void;
  seekTo(seconds: number): void;
  seekBy(delta: number): void;
  close(): void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PREF_KEY = "neo-fm:data-saver";
/** Signed-URL refreshes allowed per track before we surface an error. */
const MAX_REFRESH_ATTEMPTS = 2;
const REFRESH_BACKOFF_MS = [1000, 3000] as const;

export function usePlayer(): PlayerContextValue {
  const v = useContext(PlayerContext);
  if (!v) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return v;
}

function postFeedback(songId: string, body: Record<string, unknown>) {
  void fetch(`/api/songs/${encodeURIComponent(songId)}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const trackRef = useRef<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const refreshAttempts = useRef(0);
  const refreshingRef = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pref, setPref] = useState<DataSaverPref>("auto");
  const [hintsLow, setHintsLow] = useState(false);

  // Per-track feedback bookkeeping (furthest play fraction, start count).
  const sentFraction = useRef(0);
  const starts = useRef(0);
  const lastPosition = useRef(0);

  useEffect(() => {
    try {
      setPref(parsePref(window.localStorage.getItem(PREF_KEY)));
    } catch {
      // storage blocked: stay on auto
    }
    const conn = (navigator as unknown as {
      connection?: EventTarget & { saveData?: boolean; effectiveType?: string };
    }).connection;
    const update = () => setHintsLow(isDataSaverActive("auto", readConnectionHints()));
    update();
    conn?.addEventListener("change", update);
    return () => conn?.removeEventListener("change", update);
  }, []);

  const dataSaver = pref === "on" || (pref === "auto" && hintsLow);

  const setDataSaverPref = useCallback((p: DataSaverPref) => {
    setPref(p);
    try {
      window.localStorage.setItem(PREF_KEY, p);
    } catch {
      // best effort
    }
  }, []);

  const reportPlay = useCallback(() => {
    const el = audioRef.current;
    const t = trackRef.current;
    if (!el || !t || !el.duration || !isFinite(el.duration)) return;
    const pct = Math.min(1, el.currentTime / el.duration);
    if (pct <= sentFraction.current + 0.2) return;
    sentFraction.current = pct;
    postFeedback(t.songId, { kind: "play_pct", value: Number(pct.toFixed(2)) });
  }, []);

  const load = useCallback((next: PlayerTrack) => {
    const el = audioRef.current;
    const cur = trackRef.current;
    if (cur && cur.songId === next.songId) {
      // Same song re-mounted (e.g. navigating back): keep position, just
      // refresh metadata and adopt a newer signed URL only if idle.
      trackRef.current = { ...cur, ...next, url: el && !el.paused ? cur.url : next.url };
      setTrack(trackRef.current);
      return;
    }
    sentFraction.current = 0;
    starts.current = 0;
    refreshAttempts.current = 0;
    setPlaybackError(false);
    setRefreshError(null);
    trackRef.current = next;
    setTrack(next);
    setCurrentTime(0);
    setDuration(next.durationHint ?? 0);
    if (el) {
      el.pause();
      el.src = next.url;
      el.load();
    }
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const seekTo = useCallback((s: number) => {
    const el = audioRef.current;
    if (!el) return;
    const max = isFinite(el.duration) && el.duration > 0 ? el.duration : s;
    el.currentTime = Math.min(Math.max(0, s), max);
  }, []);

  const seekBy = useCallback(
    (d: number) => {
      const el = audioRef.current;
      if (el) seekTo(el.currentTime + d);
    },
    [seekTo],
  );

  const close = useCallback(() => {
    const el = audioRef.current;
    reportPlay();
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    if (retryTimer.current) clearTimeout(retryTimer.current);
    trackRef.current = null;
    setTrack(null);
    setPlaybackError(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    clearMediaSession();
  }, [reportPlay]);

  // Tier-2 signed-URL refresh: the URL expired mid-session. Bounded: a
  // fresh URL that also fails (deleted file, offline, 5xx) must not loop,
  // so we back off, give up after MAX_REFRESH_ATTEMPTS and show an error.
  const attemptRefresh = useCallback(async () => {
    const t = trackRef.current;
    const el = audioRef.current;
    if (!t || !el || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    const resumeAt = lastPosition.current;
    const wasPlaying = !el.paused;
    try {
      // Each loop iteration is one signed-URL request. A URL that loads
      // resets the counter (onLoadedMetadata); one that errors again
      // re-enters here and keeps counting, so the total stays bounded.
      while (refreshAttempts.current < MAX_REFRESH_ATTEMPTS) {
        const attempt = refreshAttempts.current++;
        if (attempt > 0) {
          await new Promise<void>((resolve) => {
            retryTimer.current = setTimeout(resolve, REFRESH_BACKOFF_MS[attempt - 1] ?? 3000);
          });
          // Track closed or changed while we waited.
          if (trackRef.current?.songId !== t.songId) return;
        }
        try {
          const res = await fetch(`/api/songs/${encodeURIComponent(t.songId)}/audio-url`, {
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as { url: string };
          trackRef.current = { ...t, url: body.url };
          setTrack(trackRef.current);
          el.src = body.url;
          el.load();
          el.currentTime = resumeAt;
          if (wasPlaying) void el.play().catch(() => undefined);
          return;
        } catch (e) {
          setRefreshError(e instanceof Error ? e.message : String(e));
        }
      }
      setPlaybackError(true);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  const onError = useCallback(() => {
    if (refreshAttempts.current >= MAX_REFRESH_ATTEMPTS) {
      setPlaybackError(true);
      return;
    }
    void attemptRefresh();
  }, [attemptRefresh]);

  const retry = useCallback(() => {
    refreshAttempts.current = 0;
    setPlaybackError(false);
    setRefreshError(null);
    void attemptRefresh();
  }, [attemptRefresh]);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // Only one thing plays at a time: a different <audio> starting (library
  // row, compare page) pauses the global player.
  useEffect(() => {
    const onAnyPlay = (e: Event) => {
      if (e.target !== audioRef.current) audioRef.current?.pause();
    };
    document.addEventListener("play", onAnyPlay, true);
    return () => document.removeEventListener("play", onAnyPlay, true);
  }, []);

  // Media Session: metadata + handlers follow the current track.
  useEffect(() => {
    if (!track) return;
    setMediaMetadata({
      title: track.title,
      artist: track.subtitle ?? "neo-fm",
      artwork: track.artwork,
    });
    setMediaHandlers({
      play: () => void audioRef.current?.play().catch(() => undefined),
      pause: () => audioRef.current?.pause(),
      seekBy,
      seekTo,
      stop: close,
    });
  }, [track, seekBy, seekTo, close]);

  useEffect(() => {
    setMediaPlaybackState(playing);
  }, [playing]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      track,
      playing,
      currentTime,
      duration,
      refreshing,
      refreshError,
      playbackError,
      retry,
      dataSaver,
      dataSaverPref: pref,
      setDataSaverPref,
      audioRef,
      load,
      toggle,
      seekTo,
      seekBy,
      close,
    }),
    [track, playing, currentTime, duration, refreshing, refreshError, playbackError, retry, dataSaver, pref, setDataSaverPref, load, toggle, seekTo, seekBy, close],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        data-global-player
        className="hidden"
        preload={dataSaver ? "none" : "metadata"}
        crossOrigin="anonymous"
        onPlay={() => {
          setPlaying(true);
          starts.current += 1;
          const t = trackRef.current;
          if (t && starts.current === 2) postFeedback(t.songId, { kind: "replay" });
        }}
        onPause={() => {
          setPlaying(false);
          reportPlay();
        }}
        onEnded={() => {
          setPlaying(false);
          reportPlay();
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          lastPosition.current = el.currentTime;
          setCurrentTime(el.currentTime);
          if (isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
            setMediaPosition(el.currentTime, el.duration);
          }
        }}
        onPlaying={() => {
          refreshAttempts.current = 0;
          setPlaybackError(false);
          setRefreshError(null);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d) && d > 0) setDuration(d);
          // The (possibly refreshed) URL loaded: recovery worked.
          refreshAttempts.current = 0;
        }}
        onError={onError}
      />
    </PlayerContext.Provider>
  );
}
