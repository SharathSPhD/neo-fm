"use client";

import { useCallback, useEffect, useState } from "react";

import {
  MANDATORY_TYPES,
  NOTIFICATION_TYPES,
  type NotificationType,
  type ResolvedPrefs,
} from "@/lib/notifications/types";

const LABELS: Record<NotificationType, { name: string; hint: string }> = {
  song_ready: { name: "Song ready", hint: "When a song finishes generating." },
  song_failed: { name: "Song couldn't be finished", hint: "Always shown in the app so you can retry." },
  like: { name: "Likes", hint: "Someone liked one of your public songs. Grouped, never named." },
  follow: { name: "New followers", hint: "Someone started following you." },
  collection_add: { name: "Added to a playlist", hint: "One of your public songs was added to someone's playlist." },
  dedication: { name: "Dedications", hint: "A song was dedicated to you." },
  takedown: { name: "Takedown notices", hint: "Always shown in the app: a song of yours was removed from public view." },
};

const b64uToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

type PushState = "unknown" | "unavailable" | "unsupported" | "blocked" | "off" | "on";

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<ResolvedPrefs | null>(null);
  const [push, setPush] = useState<PushState>("unknown");
  const [vapid, setVapid] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detectPush = useCallback(async (publicKey: string | null) => {
    if (!publicKey) return setPush("unavailable");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return setPush("unsupported");
    }
    if (Notification.permission === "denied") return setPush("blocked");
    try {
      const reg = await navigator.serviceWorker.ready;
      setPush((await reg.pushManager.getSubscription()) ? "on" : "off");
    } catch {
      setPush("unsupported");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [p, k] = await Promise.all([
          fetch("/api/notifications?limit=1", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/notifications/push/key", { cache: "no-store" }).then((r) => r.json()),
        ]);
        setPrefs((p as { prefs: ResolvedPrefs }).prefs);
        const key = (k as { enabled: boolean; publicKey?: string }).enabled ? (k as { publicKey: string }).publicKey : null;
        setVapid(key);
        await detectPush(key);
      } catch {
        setMsg("Couldn't load your settings.");
      }
    })();
  }, [detectPush]);

  async function setPref(t: NotificationType, field: "in_app" | "push", value: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [t]: { ...prefs[t], [field]: value } });
    setMsg(null);
    const res = await fetch("/api/notifications/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [t]: { [field]: value } }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setPrefs(before);
      setMsg("Couldn't save that change.");
    }
  }

  async function enablePush() {
    if (!vapid) return;
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPush(perm === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapid) });
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/notifications/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, userAgent: navigator.userAgent.slice(0, 200) }),
      });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setMsg("This browser's push service isn't supported.");
        return;
      }
      setPush("on");
    } catch {
      setMsg("Couldn't turn on push notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/notifications/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setPush("off");
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) return <p className="text-sm text-foreground/60">{msg ?? "Loading…"}</p>;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2 rounded-xl border border-muted/30 p-4">
        <h2 className="text-lg font-medium">Push notifications on this device</h2>
        {push === "unavailable" ? (
          <p className="text-sm text-foreground/60">Push notifications aren&apos;t available yet. The bell works without them.</p>
        ) : push === "unsupported" ? (
          <p className="text-sm text-foreground/60">This browser doesn&apos;t support push notifications. On iPhone, add neo-fm to your Home Screen first.</p>
        ) : push === "blocked" ? (
          <p className="text-sm text-foreground/60">Notifications are blocked for this site in your browser settings.</p>
        ) : push === "on" ? (
          <button type="button" onClick={() => void disablePush()} disabled={busy} className="min-h-11 w-fit rounded-lg border border-muted/50 px-4 text-sm">
            Turn off on this device
          </button>
        ) : push === "off" ? (
          <button type="button" onClick={() => void enablePush()} disabled={busy} className="min-h-11 w-fit rounded-lg bg-accent px-4 text-sm text-background disabled:opacity-50">
            Turn on for this device
          </button>
        ) : (
          <p className="text-sm text-foreground/60">Checking…</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">What to notify me about</h2>
        <div role="table" aria-label="Notification preferences" className="flex flex-col divide-y divide-muted/20 rounded-xl border border-muted/30">
          <div role="row" className="flex items-center gap-3 px-4 py-2 text-xs uppercase tracking-wider text-foreground/50">
            <span role="columnheader" className="flex-1">Type</span>
            <span role="columnheader" className="w-16 text-center">In app</span>
            <span role="columnheader" className="w-16 text-center">Push</span>
          </div>
          {NOTIFICATION_TYPES.map((t) => {
            const mandatory = MANDATORY_TYPES.includes(t);
            return (
              <div key={t} role="row" className="flex items-center gap-3 px-4 py-3">
                <div role="cell" className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{LABELS[t].name}</p>
                  <p className="text-xs text-foreground/55">{LABELS[t].hint}</p>
                </div>
                <label role="cell" className="flex h-11 w-16 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={prefs[t].in_app}
                    disabled={mandatory}
                    onChange={(e) => void setPref(t, "in_app", e.target.checked)}
                    aria-label={`${LABELS[t].name}: in app`}
                    className="h-5 w-5"
                  />
                </label>
                <label role="cell" className="flex h-11 w-16 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={prefs[t].push}
                    onChange={(e) => void setPref(t, "push", e.target.checked)}
                    aria-label={`${LABELS[t].name}: push`}
                    className="h-5 w-5"
                  />
                </label>
              </div>
            );
          })}
        </div>
      </section>
      {msg ? (
        <p role="status" className="text-sm text-foreground/70">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
