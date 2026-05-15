"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

export type LibrarySong = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
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
    const channel = supabase
      .channel(`jobs:user=${userId}`)
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
              const j = payload.new as { id: string; status: string; created_at: string };
              const stub: LibrarySong = {
                id: j.id,
                status: j.status,
                error: null,
                created_at: j.created_at,
                language: null,
                style_family: null,
                audio_url: null,
                duration_seconds: null,
              };
              return [stub, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const j = payload.new as { id: string; status: string; error: string | null };
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
    <ul className="flex flex-col gap-3">
      {songs.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center gap-3 rounded-md border border-muted/30 bg-muted/10 px-4 py-3"
        >
          <div className="flex flex-1 flex-col">
            <span className="text-base font-medium font-mono text-foreground/70">
              {s.id.slice(0, 8)}
            </span>
            <span className="text-xs text-foreground/50">
              {[s.style_family, s.language].filter(Boolean).join(" · ") || "—"}
            </span>
          </div>
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
            <span className="text-xs text-foreground/40">
              {s.status === "ready"
                ? "Audio URL pending..."
                : s.status === "failed"
                  ? "Failed"
                  : "Queued"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status, error }: { status: string; error: string | null }) {
  const tone =
    status === "ready"
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
