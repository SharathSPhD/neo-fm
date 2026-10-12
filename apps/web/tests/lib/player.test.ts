import { afterEach, describe, expect, it, vi } from "vitest";

import { isDataSaverActive, parsePref } from "@/lib/player/bandwidth";
import {
  clearMediaSession,
  setMediaHandlers,
  setMediaMetadata,
  setMediaPlaybackState,
  setMediaPosition,
} from "@/lib/player/media-session";
import manifest from "@/app/manifest";

describe("data saver", () => {
  it("follows browser hints in auto mode", () => {
    expect(isDataSaverActive("auto", {})).toBe(false);
    expect(isDataSaverActive("auto", { saveData: true })).toBe(true);
    expect(isDataSaverActive("auto", { effectiveType: "2g" })).toBe(true);
    expect(isDataSaverActive("auto", { effectiveType: "slow-2g" })).toBe(true);
    expect(isDataSaverActive("auto", { effectiveType: "4g" })).toBe(false);
  });
  it("explicit preference always wins", () => {
    expect(isDataSaverActive("off", { saveData: true })).toBe(false);
    expect(isDataSaverActive("on", { effectiveType: "4g" })).toBe(true);
  });
  it("parses stored values defensively", () => {
    expect(parsePref("on")).toBe("on");
    expect(parsePref("off")).toBe("off");
    expect(parsePref("garbage")).toBe("auto");
    expect(parsePref(null)).toBe("auto");
  });
});

describe("media session", () => {
  const handlers: Record<string, ((d: Record<string, number>) => void) | null> = {};
  const ms = {
    metadata: null as unknown,
    playbackState: "none",
    setActionHandler: vi.fn((a: string, h) => {
      handlers[a] = h;
    }),
    setPositionState: vi.fn(),
  };

  function install() {
    vi.stubGlobal("navigator", { mediaSession: ms });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: unknown) {}
      },
    );
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it("is a no-op where the API is missing", () => {
    vi.stubGlobal("navigator", {});
    expect(() => {
      setMediaMetadata({ title: "t", artist: "a" });
      setMediaPlaybackState(true);
      setMediaPosition(1, 2);
      clearMediaSession();
    }).not.toThrow();
  });

  it("sets metadata with a fallback icon and wires transport handlers", () => {
    install();
    setMediaMetadata({ title: "Song", artist: "Hindustani" });
    const init = (ms.metadata as { init: { title: string; artwork: { src: string }[] } }).init;
    expect(init.title).toBe("Song");
    expect(init.artwork[0]!.src).toBe("/icon-512.png");

    const calls: string[] = [];
    setMediaHandlers({
      play: () => calls.push("play"),
      pause: () => calls.push("pause"),
      stop: () => calls.push("stop"),
      seekBy: (d) => calls.push(`by${d}`),
      seekTo: (s) => calls.push(`to${s}`),
    });
    handlers.play!({});
    handlers.seekforward!({});
    handlers.seekbackward!({ seekOffset: 5 });
    handlers.seekto!({ seekTime: 42 });
    expect(calls).toEqual(["play", "by10", "by-5", "to42"]);
  });

  it("ignores unusable position state", () => {
    install();
    setMediaPosition(5, Number.NaN);
    expect(ms.setPositionState).not.toHaveBeenCalled();
    setMediaPosition(99, 30);
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 30, playbackRate: 1, position: 30 });
  });
});

describe("web app manifest", () => {
  const m = manifest();
  it("is installable", () => {
    expect(m.display).toBe("standalone");
    expect(m.id).toBe("/");
    const any = (m.icons ?? []).filter((i) => i.purpose === "any");
    const maskable = (m.icons ?? []).filter((i) => i.purpose === "maskable");
    expect(any.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(maskable.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    // maskable art must not reuse the full-bleed "any" files
    expect(maskable.every((i) => i.src.includes("maskable"))).toBe(true);
    expect((m.shortcuts ?? []).length).toBeGreaterThan(0);
  });
});
