/**
 * Lock-screen / notification controls via the Media Session API.
 * Every call is feature-detected: browsers without it simply skip.
 */

export interface MediaSessionTrack {
  title: string;
  artist: string;
  album?: string;
  /** Absolute or root-relative artwork URL; falls back to the app icon. */
  artwork?: string | null;
}

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  seekBy(deltaSeconds: number): void;
  seekTo(seconds: number): void;
  stop(): void;
  /** Queue navigation; omit when there is nothing to skip to (the control is hidden). */
  next?(): void;
  previous?(): void;
}

import { nativeMediaSession } from "../native/media-session-bridge";

const DEFAULT_ARTWORK = "/icon-512.png";
const SEEK_STEP = 10;

type MS = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler(action: string, h: ((d: Record<string, number>) => void) | null): void;
  setPositionState?(s?: { duration: number; playbackRate: number; position: number }): void;
};

function session(): MS | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return null;
  return (navigator as unknown as { mediaSession: MS }).mediaSession;
}

export function setMediaMetadata(track: MediaSessionTrack): void {
  const src0 = track.artwork || DEFAULT_ARTWORK;
  nativeMediaSession()?.setMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? "neo-fm",
    artwork: [{ src: new URL(src0, globalThis.location?.origin ?? "https://www.neo-fm.com").href, sizes: "512x512" }],
  });
  const ms = session();
  const Meta = (globalThis as unknown as {
    MediaMetadata?: new (init: unknown) => unknown;
  }).MediaMetadata;
  if (!ms || !Meta) return;
  const src = track.artwork || DEFAULT_ARTWORK;
  ms.metadata = new Meta({
    title: track.title,
    artist: track.artist,
    album: track.album ?? "neo-fm",
    artwork: [96, 192, 256, 512].map((s) => ({ src, sizes: `${s}x${s}` })),
  });
}

export function setMediaHandlers(h: MediaSessionHandlers): void {
  const native = nativeMediaSession();
  if (native) {
    const on = (action: string, fn: ((d: { seekTime?: number | null }) => void) | null) => native.setActionHandler({ action }, fn);
    on("play", () => h.play());
    on("pause", () => h.pause());
    on("stop", () => h.stop());
    on("nexttrack", h.next ? () => h.next?.() : null);
    on("previoustrack", h.previous ? () => h.previous?.() : null);
    on("seekbackward", () => h.seekBy(-SEEK_STEP));
    on("seekforward", () => h.seekBy(SEEK_STEP));
    on("seekto", (d) => {
      if (typeof d?.seekTime === "number") h.seekTo(d.seekTime);
    });
  }
  const ms = session();
  if (!ms) return;
  const set = (a: string, fn: ((d: Record<string, number>) => void) | null) => {
    try {
      ms.setActionHandler(a, fn);
    } catch {
      // Some browsers throw for actions they do not support.
    }
  };
  set("play", () => h.play());
  set("pause", () => h.pause());
  set("stop", () => h.stop());
  set("nexttrack", h.next ? () => h.next?.() : null);
  set("previoustrack", h.previous ? () => h.previous?.() : null);
  set("seekbackward", (d) => h.seekBy(-(d?.seekOffset ?? SEEK_STEP)));
  set("seekforward", (d) => h.seekBy(d?.seekOffset ?? SEEK_STEP));
  set("seekto", (d) => {
    if (typeof d?.seekTime === "number") h.seekTo(d.seekTime);
  });
}

export function setMediaPlaybackState(playing: boolean): void {
  nativeMediaSession()?.setPlaybackState({ playbackState: playing ? "playing" : "paused" });
  const ms = session();
  if (ms) ms.playbackState = playing ? "playing" : "paused";
}

export function setMediaPosition(position: number, duration: number): void {
  if (isFinite(duration) && duration > 0) {
    nativeMediaSession()?.setPositionState({ duration, playbackRate: 1, position: Math.min(Math.max(0, position), duration) });
  }
  const ms = session();
  if (!ms?.setPositionState || !isFinite(duration) || duration <= 0) return;
  try {
    ms.setPositionState({
      duration,
      playbackRate: 1,
      position: Math.min(Math.max(0, position), duration),
    });
  } catch {
    // position > duration etc. on some engines; non-fatal.
  }
}

export function clearMediaSession(): void {
  const native = nativeMediaSession();
  if (native) {
    native.setPlaybackState({ playbackState: "none" });
    for (const a of ["play", "pause", "stop", "nexttrack", "previoustrack", "seekbackward", "seekforward", "seekto"]) native.setActionHandler({ action: a }, null);
  }
  const ms = session();
  if (!ms) return;
  ms.metadata = null;
  ms.playbackState = "none";
  for (const a of ["play", "pause", "stop", "seekbackward", "seekforward", "seekto"]) {
    try {
      ms.setActionHandler(a, null);
    } catch {
      // ignore
    }
  }
}
