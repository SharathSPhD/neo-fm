"use client";

/**
 * Cover-art-first grid for the user's library. The list-mode counterpart
 * lives in `song-list.tsx`; the toolbar's view toggle decides which one
 * mounts. Both render the same `LibrarySong[]` shape so realtime updates,
 * favourites, rename, and delete work identically.
 *
 * Cards are 1:1 aspect-ratio with the cover art occupying the full square.
 * Title, style and a status pill stack below. Favourite / rename / delete
 * actions live in a small overlay that fades in on hover (and is always
 * visible on touch devices).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { CoverArt } from "@/components/cover-art";
import { cn } from "@/lib/cn";
import { createBrowserSupabase } from "@/lib/supabase/client";

import { RecoverButton } from "./recover-button";
import type { LibrarySong } from "./song-list";

export type LibrarySongWithCover = LibrarySong & {
  cover_url: string | null;
};

export function SongGrid({
  initialSongs,
  userId,
}: {
  initialSongs: LibrarySongWithCover[];
  userId: string;
}) {
  const router = useRouter();
  const [songs, setSongs] = useState<LibrarySongWithCover[]>(initialSongs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setSongs(initialSongs);
  }, [initialSongs]);

  async function toggleFavorite(id: string, current: boolean) {
    setBusyId(id);
    setSongs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, is_favorite: !current } : s)),
    );
    const res = await fetch(`/api/songs/${id}/favorite`, { method: "POST" });
    if (!res.ok) {
      setSongs((prev) =>
        prev.map((s) => (s.id === id ? { ...s, is_favorite: current } : s)),
      );
    }
    setBusyId(null);
  }

  async function deleteSong(id: string) {
    if (!window.confirm("Delete this song? This can't be undone.")) return;
    setBusyId(id);
    const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSongs((prev) => prev.filter((s) => s.id !== id));
      startTransition(() => router.refresh());
    }
    setBusyId(null);
  }

  useEffect(() => {
    const supabase = createBrowserSupabase();

    async function refreshAudioForJob(jobId: string) {
      try {
        const res = await fetch(`/api/songs/${jobId}/audio-url`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          url?: string;
          duration_seconds?: number | null;
        };
        if (!payload.url) return;
        setSongs((prev) =>
          prev.map((s) =>
            s.id === jobId
              ? {
                  ...s,
                  audio_url: payload.url ?? null,
                  duration_seconds:
                    payload.duration_seconds ?? s.duration_seconds,
                }
              : s,
          ),
        );
      } catch {
        /* best-effort */
      }
    }

    const channel = supabase
      .channel(`library-grid:user=${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setSongs((prev) => {
            if (payload.eventType === "INSERT") {
              const j = payload.new as {
                id: string;
                status: string;
                created_at: string;
              };
              const stub: LibrarySongWithCover = {
                id: j.id,
                status: j.status,
                error: null,
                created_at: j.created_at,
                title: null,
                language: null,
                style_family: null,
                audio_url: null,
                duration_seconds: null,
                is_favorite: false,
                cover_url: null,
              };
              return [stub, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const j = payload.new as {
                id: string;
                status: string;
                error: string | null;
              };
              if (j.status === "completed") {
                void refreshAudioForJob(j.id);
              }
              return prev.map((s) =>
                s.id === j.id ? { ...s, status: j.status, error: j.error } : s,
              );
            }
            if (payload.eventType === "DELETE") {
              const j = payload.old as { id: string };
              return prev.filter((s) => s.id !== j.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  if (songs.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-muted/30 px-6 py-12 text-center text-sm text-foreground/50">
        No songs yet.{" "}
        <Link href="/songs/new" className="underline">
          Create your first one
        </Link>
        .
      </section>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {songs.map((s) => (
        <li key={s.id} className="group flex flex-col gap-2">
          <Link
            href={`/songs/${s.id}`}
            className="relative block aspect-square overflow-hidden rounded-lg border border-muted/30 bg-muted/10 transition hover:border-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`${s.title ?? "Song"} – open detail`}
          >
            <CoverArt
              url={s.cover_url}
              seed={s.id}
              styleFamily={s.style_family}
              alt={s.title ?? "Song cover art"}
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void toggleFavorite(s.id, s.is_favorite);
              }}
              disabled={busyId === s.id}
              aria-label={s.is_favorite ? "Unfavorite" : "Favorite"}
              className={cn(
                "absolute right-2 top-2 rounded-full bg-background/80 px-2 py-1 text-base backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                s.is_favorite
                  ? "text-amber-300"
                  : "text-foreground/40 opacity-0 hover:text-foreground/80 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {s.is_favorite ? "★" : "☆"}
            </button>
            <span
              className={cn(
                "absolute left-2 bottom-2 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider backdrop-blur",
                statusTone(s.status),
              )}
            >
              {s.status}
            </span>
          </Link>
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/songs/${s.id}`}
              className="flex flex-1 flex-col text-left hover:opacity-80"
            >
              <span
                className="line-clamp-1 text-sm font-medium text-foreground"
                title={s.title ?? undefined}
              >
                {s.title ?? songFallbackTitle(s)}
              </span>
              <span className="text-xs text-foreground/55">
                {[s.style_family, s.language].filter(Boolean).join(" · ") ||
                  "—"}
              </span>
            </Link>
            {isStuck(s) ? (
              <RecoverButton
                songId={s.id}
                label={s.status === "failed" ? "Retry" : "Recover"}
              />
            ) : null}
            <button
              type="button"
              disabled={busyId === s.id}
              onClick={() => void deleteSong(s.id)}
              aria-label="Delete song"
              title="Delete song"
              className="rounded p-1 text-foreground/35 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ×
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function songFallbackTitle(s: LibrarySong): string {
  const style = s.style_family ?? "song";
  const date = s.created_at.slice(0, 10);
  return `${style.charAt(0).toUpperCase() + style.slice(1)} - ${date}`;
}

function isStuck(s: LibrarySong): boolean {
  if (s.status === "failed") return true;
  if (s.status !== "completed") return false;
  if (s.audio_url) return false;
  const ageMs = Date.now() - new Date(s.created_at).getTime();
  return ageMs > 60_000;
}

function statusTone(status: string): string {
  if (status === "completed")
    return "border-emerald-400/60 bg-emerald-400/15 text-emerald-200";
  if (status === "failed")
    return "border-red-400/60 bg-red-400/15 text-red-200";
  return "border-accent/60 bg-accent/15 text-accent";
}
