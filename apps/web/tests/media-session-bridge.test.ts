import { afterEach, describe, expect, it, vi } from "vitest";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14) NeoFmApp/0.1.0 (android)";

async function load(ua: string, cap?: unknown) {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent: ua });
  vi.stubGlobal("Capacitor", cap);
  return import("../lib/native/media-session-bridge");
}

afterEach(() => vi.unstubAllGlobals());

describe("nativeMediaSession", () => {
  it("is null in a plain browser even if Capacitor exists", async () => {
    const m = await load("Mozilla/5.0 Safari/604", { registerPlugin: () => ({}) });
    expect(m.nativeMediaSession()).toBeNull();
  });
  it("is null on iOS (WKWebView handles navigator.mediaSession)", async () => {
    const m = await load("Mozilla/5.0 (iPhone) NeoFmApp/0.1.0 (ios)", { registerPlugin: () => ({}) });
    expect(m.nativeMediaSession()).toBeNull();
  });
  it("is null in the Android shell until Capacitor is injected", async () => {
    expect((await load(ANDROID_UA)).nativeMediaSession()).toBeNull();
  });
  it("forwards calls in the Android shell and swallows native rejections", async () => {
    const setPlaybackState = vi.fn().mockRejectedValue(new Error("no service"));
    const registerPlugin = vi.fn().mockReturnValue({ setPlaybackState });
    const m = await load(ANDROID_UA, { registerPlugin });
    const native = m.nativeMediaSession()!;
    await expect(native.setPlaybackState({ playbackState: "playing" })).resolves.toBeUndefined();
    expect(registerPlugin).toHaveBeenCalledWith("MediaSession");
    expect(setPlaybackState).toHaveBeenCalledWith({ playbackState: "playing" });
  });
});
