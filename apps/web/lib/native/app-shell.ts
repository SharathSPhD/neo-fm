/**
 * Detection of the Capacitor Android/iOS shell (apps/mobile). The shell appends `NeoFmApp/<version> (android|ios)` to the
 * WebView user agent, so the same web app can hide what the stores forbid inside an app: purchase UI for digital goods
 * (Apple 3.1.1, Google Play billing). Purchases happen on the web; the account carries the entitlement.
 */
export type AppShell = { platform: "android" | "ios"; version: string };

const SHELL_UA = /\bNeoFmApp\/(\S+) \((android|ios)\)/;

export function parseAppShell(userAgent: string | null | undefined): AppShell | null {
  const m = userAgent ? SHELL_UA.exec(userAgent) : null;
  return m ? { version: m[1]!, platform: m[2] as AppShell["platform"] } : null;
}
