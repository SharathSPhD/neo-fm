"use client";

/**
 * Notification bell for the top nav: unread count, recent items, mark read.
 * Works without push. Polls /api/notifications while the tab is visible
 * (and on focus); a failed poll keeps the last good state.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { renderNotification, type NotificationRow } from "@/lib/notifications/types";

const POLL_MS = 60_000;

export function NotificationBell() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=15", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { items: NotificationRow[]; unread: number };
      setItems(j.items);
      setUnread(j.unread);
    } catch {
      // offline or transient: keep what we have
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const t = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(body: { ids: string[] } | { all: true }) {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify(body),
      });
    } catch {
      // best effort; the next poll reconciles
    }
  }

  function onItem(n: NotificationRow) {
    setOpen(false);
    if (!n.read_at) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void markRead({ ids: [n.id] });
    }
  }

  function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    void markRead({ all: true });
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void refresh();
        }}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/70 hover:bg-muted/20 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-background"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-muted/40 bg-background shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-muted/30 px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <button
              type="button"
              onClick={markAll}
              disabled={unread === 0}
              className="min-h-9 px-2 text-xs text-accent disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-foreground/60">Nothing yet. We&apos;ll tell you when a song is ready.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => {
                const r = renderNotification(n);
                return (
                  <li key={n.id}>
                    <Link
                      href={r.href}
                      onClick={() => onItem(n)}
                      className={`flex min-h-11 flex-col gap-0.5 px-3 py-2 hover:bg-muted/20 focus:outline-none focus-visible:bg-muted/20 ${
                        n.read_at ? "text-foreground/65" : "font-medium"
                      }`}
                    >
                      <span className="text-sm">{r.title}</span>
                      {r.body ? <span className="text-xs font-normal text-foreground/60">{r.body}</span> : null}
                      <span className="text-[11px] font-normal text-foreground/45">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-muted/30 px-3 py-2">
            <Link
              href="/account/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-accent underline underline-offset-4"
            >
              Notification settings
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
