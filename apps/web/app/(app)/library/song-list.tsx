"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

import { RecoverButton } from "./recover-button";

export type LibrarySong = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  title: string | null;
  language: string | null;
  style_family: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
};

export function SongList({
  initialSongs,
  userId,
}: {
  initialSongs: LibrarySong[];
  userId: string;
}) {
  const [songs, setSongs] = useState<LibrarySong[]>(initialSongs);

  useEffect(() => {
    const supabase = createBrowserSupabase();

    // Refetch a fresh signed URL whenever a track INSERT lands for a song
    // in the user's library. ADR 0012 Tier-2 pattern, but kicked off by
    // realtime rather than a player error.
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
        // Realtime is best-effort. If the refetch fails we leave the
        // library showing "Audio URL pending..." until the next reload.
      }
    }

    const channel = supabase
      .channel(`library:user=${userId}`)
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
              const stub: LibrarySong = {
                id: j.id,
                status: j.status,
                error: null,
                created_at: j.created_at,
                title: null,
                language: null,
                style_family: null,
                audio_url: null,
                duration_seconds: null,
              };
              return [stub, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const j = payload.new as {
                id: string;
                status: string;
                error: string | null;
              };
              // When the worker flips status to 'completed' but the
              // tracks INSERT hasn't fired yet (Postgres replication is
              // eventually-consistent across separate tables), kick off
              // a fetch. If the row is already there, we just get the
              // signed URL a few hundred ms early.
              if (j.status === "completed") {
                void refreshAudioForJob(j.id);
              }
              return prev.map((s) =>
                s.id === j.id
                  ? { ...s, status: j.status, error: j.error }
                  : s,
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
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tracks",
        },
        (payload) => {
          // RLS on tracks already scopes this to the current user's jobs,
          // but the realtime channel is shared across all authenticated
          // listeners -- only act when the job_id is in our current
          // library state. Triggers an audio-url refetch.
          const t = payload.new as { job_id: string };
          setSongs((prev) => {
            if (prev.some((s) => s.id === t.job_id)) {
              void refreshAudioForJob(t.job_id);
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
    <ul className="flex flex-col gap-3">
      {songs.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center gap-3 rounded-md border border-muted/30 bg-muted/10 px-4 py-3"
        >
          <Link href={`/songs/${s.id}`} className="flex flex-1 flex-col hover:opacity-80">
            <span className="text-base font-medium text-foreground" title={s.title ?? undefined}>
              {s.title ?? songFallbackTitle(s)}
            </span>
            <span className="text-xs text-foreground/50">
              {[s.style_family, s.language].filter(Boolean).join(" · ") || "—"}
            </span>
          </Link>
          <StatusPill status={s.status} error={s.error} />
          {s.audio_url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio
              controls
              preload="none"
              src={s.audio_url}
              className="h-9 w-full max-w-sm"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground/40">
                {s.status === "completed"
                  ? "Audio URL pending…"
                  : s.status === "failed"
                    ? "Failed"
                    : s.status === "processing"
                      ? "Generating…"
                      : "Queued"}
              </span>
              {isStuck(s) ? (
                <RecoverButton
                  songId={s.id}
                  label={s.status === "failed" ? "Retry" : "Recover"}
                />
              ) : null}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Render-time fallback when a row predates migration 0017 and somehow
 * arrived here with a NULL title. Migration 0017 also backfills the
 * column server-side; this fallback is belt-and-braces.
 */
function songFallbackTitle(s: LibrarySong): string {
  const style = s.style_family ?? "song";
  const date = s.created_at.slice(0, 10);
  return `${style.charAt(0).toUpperCase() + style.slice(1)} - ${date}`;
}

/**
 * "Stuck" = the user is staring at a row that won't finish on its own.
 *  - failed: model rejected, transient backend failure, etc.
 *  - completed without audio_url for more than 60s: the orphan case
 *    (no tracks row was written). Sprint C-b's recover RPC fixes both
 *    by re-enqueueing.
 *
 * 60 s grace window keeps us from flashing the button while the
 * realtime audio-url refetch is still in flight on a fresh completion.
 */
function isStuck(s: LibrarySong): boolean {
  if (s.status === "failed") return true;
  if (s.status !== "completed") return false;
  if (s.audio_url) return false;
  const ageMs = Date.now() - new Date(s.created_at).getTime();
  return ageMs > 60_000;
}

function StatusPill({ status, error }: { status: string; error: string | null }) {
  const tone =
    status === "completed"
      ? "border-emerald-400/40 text-emerald-300"
      : status === "failed"
        ? "border-red-400/40 text-red-300"
        : "border-accent/40 text-accent";
  return (
    <span
      title={error ?? undefined}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
        tone,
      )}
    >
      {status}
    </span>
  );
}
