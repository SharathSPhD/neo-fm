/**
 * Android push: the shell ships @capacitor/push-notifications (FCM). Like the media session, the remote page reaches it by
 * name on the injected `window.Capacitor`. The server keeps this off (404 push_disabled) until native push is enabled, so
 * registering is always safe to attempt.
 */
import { parseAppShell } from "./app-shell";

interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: string, cb: (d: never) => void): Promise<unknown>;
}

function plugin(): PushPlugin | null {
  if (typeof navigator === "undefined" || parseAppShell(navigator.userAgent)?.platform !== "android") return null;
  const cap = (globalThis as unknown as {
    Capacitor?: { registerPlugin?: (n: string) => PushPlugin; Plugins?: Record<string, PushPlugin | undefined> };
  }).Capacitor;
  return (typeof cap?.registerPlugin === "function" ? cap.registerPlugin("PushNotifications") : cap?.Plugins?.PushNotifications) ?? null;
}

/** A tapped notification opens its in-app path; anything that is not a site-relative path is ignored. */
export function safeTapPath(url: unknown): string | null {
  return typeof url === "string" && /^\/(?!\/)/.test(url) ? url : null;
}

const FLAG = "neofm.nativePush";

/** True once this device's token was accepted by the server (set by startNativePush, read by the notification settings). */
export function nativePushRegistered(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* storage can be unavailable; the settings just keep saying "coming soon" */
  }
}

let started = false;

/** Registers this device for push and sends the FCM token to the server. Resolves true when the server took the token. */
export async function startNativePush(): Promise<boolean> {
  const p = plugin();
  if (!p || started) return false;
  started = true;
  try {
    // Ask the server first: while native push is off there is no reason to show a permission prompt.
    const probe = await fetch("/api/notifications/push/native", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "probe-probe-probe-probe" }) });
    if (probe.status === 404 || probe.status === 401) return false;
    let perm = await p.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await p.requestPermissions();
    if (perm.receive !== "granted") return false;
    const ok = new Promise<boolean>((resolve) => {
      void p.addListener("registration", ((d: { value: string }) => {
        fetch("/api/notifications/push/native", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: d.value, platform: "android" }) })
          .then((r) => { remember(r.ok); resolve(r.ok); })
          .catch(() => resolve(false));
      }) as (d: never) => void);
      void p.addListener("registrationError", (() => resolve(false)) as (d: never) => void);
    });
    void p.addListener("pushNotificationActionPerformed", ((d: { notification?: { data?: { url?: unknown } } }) => {
      const path = safeTapPath(d.notification?.data?.url);
      if (path) window.location.assign(path);
    }) as (d: never) => void);
    await p.register();
    return await ok;
  } catch {
    return false;
  }
}
