"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

import { formatTime } from "./format-time";
import { usePlayer } from "./player-provider";

/**
 * Persistent bar shown on every authed page except the playing song's own
 * page (which has the full player). Sits above the mobile bottom nav.
 */
export function MiniPlayer() {
  const p = usePlayer();
  const pathname = usePathname();
  const { t } = useUiLang();
  const { track } = p;
  if (!track || pathname === `/songs/${track.songId}`) return null;

  const pct = p.duration > 0 ? Math.min(100, (p.currentTime / p.duration) * 100) : 0;

  return (
    <>
      {/* Spacer so page content is never hidden behind the fixed bar. */}
      <div aria-hidden className="h-20 sm:h-0" />
      <section
        aria-label={t("player.openSong")}
        data-testid="mini-player"
        className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 overflow-hidden glass rounded-2xl shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
      >
        <div className="flex items-center gap-3 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={track.artwork || "/icon-192.png"}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            className="h-10 w-10 flex-none rounded-md object-cover"
          />
          <Link
            href={`/songs/${track.songId}`}
            className="min-w-0 flex-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex items-center gap-2 truncate text-sm font-medium">
              <span className="eq text-accent" data-paused={p.playing ? "false" : "true"} aria-hidden>
                <i /><i /><i /><i />
              </span>
              <span className="truncate">{track.title}</span>
            </span>
            <span className="block truncate text-xs text-foreground/60">
              {formatTime(p.currentTime)} / {formatTime(p.duration)}
              {track.subtitle ? ` · ${track.subtitle}` : ""}
            </span>
          </Link>
          {p.queueLength > 1 ? (
            <button
              type="button"
              onClick={p.previous}
              disabled={!p.hasPrevious && p.currentTime <= 3}
              aria-label={t("player.previous")}
              className="inline-flex h-11 w-9 flex-none items-center justify-center rounded-full text-foreground/70 hover:text-foreground disabled:opacity-30"
            >
              <span aria-hidden>⏮</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={p.toggle}
            aria-label={p.playing ? t("player.pause") : t("player.play")}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent text-background"
          >
            <span aria-hidden>{p.playing ? "❚❚" : "▶"}</span>
          </button>
          {p.queueLength > 1 ? (
            <button
              type="button"
              onClick={p.next}
              disabled={!p.hasNext}
              aria-label={t("player.next")}
              className="inline-flex h-11 w-9 flex-none items-center justify-center rounded-full text-foreground/70 hover:text-foreground disabled:opacity-30"
            >
              <span aria-hidden>⏭</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={p.close}
            aria-label={t("player.close")}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-foreground/70 hover:text-foreground"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
        {p.playbackError ? (
          <div role="alert" className="flex items-center justify-between gap-2 border-t border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs text-red-200">
            <span>{t("player.error")}</span>
            <button type="button" onClick={p.retry} className="min-h-[44px] px-2 underline">
              {t("player.retry")}
            </button>
          </div>
        ) : null}
        <div aria-hidden className="h-1 bg-muted/30">
          <div className="h-full bg-linear-to-r from-accent to-pink-500" style={{ width: `${pct}%` }} />
        </div>
      </section>
    </>
  );
}
