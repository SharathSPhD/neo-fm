/**
 * Android WebView stops page audio once the app is backgrounded and ignores navigator.mediaSession, so the shell ships
 * @capgo/capacitor-media-session (a foreground media service with notification and lock-screen controls). The page is
 * remote, so it cannot import the plugin package; Capacitor injects `window.Capacitor` and the plugin is reached by name.
 * iOS needs nothing: WKWebView honours navigator.mediaSession with the audio background mode.
 */
import { parseAppShell } from "./app-shell";

type Fn = (...args: never[]) => unknown;
export interface NativeMediaSession {
  setMetadata(o: { title?: string; artist?: string; album?: string; artwork?: { src: string; sizes?: string }[] }): Promise<void>;
  setPlaybackState(o: { playbackState: "none" | "paused" | "playing" }): Promise<void>;
  setActionHandler(o: { action: string }, h: ((d: { seekTime?: number | null }) => void) | null): Promise<void>;
  setPositionState(o: { duration?: number; playbackRate?: number; position?: number }): Promise<void>;
}

let cached: NativeMediaSession | null | undefined;

/** The native plugin inside the Android shell; null in browsers and on iOS. */
export function nativeMediaSession(): NativeMediaSession | null {
  if (cached !== undefined) return cached;
  if (typeof navigator === "undefined") return null;
  const cap = (globalThis as unknown as {
    Capacitor?: { registerPlugin?: (n: string) => NativeMediaSession; Plugins?: Record<string, NativeMediaSession | undefined> };
  }).Capacitor;
  const android = parseAppShell(navigator.userAgent)?.platform === "android";
  // On a remote page only the injected native bridge exists (no @capacitor/core runtime), which exposes plugins as
  // Capacitor.Plugins.<Name>; registerPlugin is there only when the page bundles the runtime.
  const plugin = android ? (typeof cap?.registerPlugin === "function" ? cap.registerPlugin("MediaSession") : cap?.Plugins?.MediaSession) : undefined;
  cached = plugin ? safe(plugin) : null;
  return cached;
}

/** Plugin calls reject when the native side is missing; the web path must never break because of that. */
function safe(plugin: NativeMediaSession): NativeMediaSession {
  return new Proxy(plugin, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        try {
          return Promise.resolve((v as Fn as (...a: unknown[]) => unknown).apply(target, args)).catch(() => undefined);
        } catch {
          return Promise.resolve();
        }
      };
    },
  });
}
