"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
  is_favorite: boolean;
  visibility?: "public" | "unlisted" | "private" | null;
};

type BatchOutcome =
  | "published"
  | "already_public"
  | "quota_hit"
  | "not_found"
  | "forbidden"
  | "not_completed";

type BatchRow = {
  job_id: string;
  public_id: string | null;
  visibility: "public" | "unlisted" | "private" | null;
  published_at: string | null;
  outcome: BatchOutcome;
};

export function SongList({
  initialSongs,
  userId,
}: {
  initialSongs: LibrarySong[];
  userId: string;
}) {
  const router = useRouter();
  const [songs, setSongs] = useState<LibrarySong[]>(initialSongs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  );
  // v1.4 Sprint 15: multi-select + batch-publish state. Selection is
  // local (no URL state) because the action is single-shot; outcomes
  // are surfaced inline below the toolbar.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchPending, setBatchPending] = useState(false);
  const [batchOutcomes, setBatchOutcomes] = useState<BatchRow[] | null>(null);

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

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setBatchOutcomes(null);
  }

  async function publishSelected() {
    if (selected.size === 0 || batchPending) return;
    setBatchPending(true);
    setBatchOutcomes(null);
    try {
      const res = await fetch("/api/songs/publish-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          job_ids: Array.from(selected),
          visibility: "public",
        }),
      });
      if (!res.ok) {
        setBatchOutcomes([]);
        return;
      }
      const payload = (await res.json()) as {
        outcomes: BatchRow[];
        summary: Record<BatchOutcome, number>;
      };
      setBatchOutcomes(payload.outcomes);
      const publishedIds = new Set(
        payload.outcomes
          .filter((r) => r.outcome === "published" || r.outcome === "already_public")
          .map((r) => r.job_id),
      );
      if (publishedIds.size > 0) {
        setSongs((prev) =>
          prev.map((s) =>
            publishedIds.has(s.id) ? { ...s, visibility: "public" } : s,
          ),
        );
      }
    } finally {
      setBatchPending(false);
    }
  }

  async function saveRename(id: string, title: string) {
    setBusyId(id);
    const res = await fetch(`/api/songs/${id}/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const payload = (await res.json()) as { title: string };
      setSongs((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: payload.title } : s)),
      );
    }
    setEditing(null);
    setBusyId(null);
  }

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
                is_favorite: false,
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

  const eligibleForBatch = songs.filter(
    (s) => s.status === "completed" && s.visibility !== "public",
  );

  return (
    <>
      <BulkPublishBar
        selectedCount={selected.size}
        eligibleCount={eligibleForBatch.length}
        pending={batchPending}
        outcomes={batchOutcomes}
        onPublish={() => void publishSelected()}
        onClear={clearSelection}
      />
      <ul className="flex flex-col gap-3">
      {songs.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center gap-3 rounded-md border border-muted/30 bg-muted/10 px-4 py-3"
        >
          {s.status === "completed" && s.visibility !== "public" ? (
            <input
              type="checkbox"
              aria-label={`Select ${s.title ?? s.id} for batch publish`}
              checked={selected.has(s.id)}
              onChange={() => toggleSelected(s.id)}
              className="size-4 cursor-pointer accent-accent"
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block size-4"
              title={
                s.status !== "completed"
                  ? "Only completed songs can be published"
                  : "Already public"
              }
            />
          )}
          <button
            type="button"
            onClick={() => toggleFavorite(s.id, s.is_favorite)}
            disabled={busyId === s.id}
            aria-label={s.is_favorite ? "Unfavorite" : "Favorite"}
            className={cn(
              "rounded-full px-2 py-1 text-base transition",
              s.is_favorite
                ? "text-amber-300"
                : "text-foreground/30 hover:text-foreground/70",
            )}
            title={s.is_favorite ? "Unfavorite" : "Favorite"}
          >
            {s.is_favorite ? "★" : "☆"}
          </button>
          {editing?.id === s.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveRename(s.id, editing.value);
              }}
              className="flex flex-1 items-center gap-2"
            >
              <input
                autoFocus
                type="text"
                maxLength={120}
                value={editing.value}
                onChange={(e) =>
                  setEditing({ id: s.id, value: e.target.value })
                }
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(null);
                }}
                className="flex-1 rounded-md border border-accent/40 bg-transparent px-3 py-1.5 text-base outline-none"
              />
              <button
                type="submit"
                disabled={busyId === s.id}
                className="text-xs text-accent hover:underline"
              >
                Save
              </button>
            </form>
          ) : (
            <Link href={`/songs/${s.id}`} className="flex flex-1 flex-col hover:opacity-80">
              <span
                className="text-base font-medium text-foreground"
                title={s.title ?? undefined}
              >
                {s.title ?? songFallbackTitle(s)}
              </span>
              <span className="text-xs text-foreground/50">
                {[s.style_family, s.language].filter(Boolean).join(" · ") || "—"}
              </span>
            </Link>
          )}
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
          <RowActions
            disabled={busyId === s.id || editing?.id === s.id}
            onRename={() =>
              setEditing({ id: s.id, value: s.title ?? "" })
            }
            onDelete={() => void deleteSong(s.id)}
          />
        </li>
      ))}
      </ul>
    </>
  );
}

function BulkPublishBar({
  selectedCount,
  eligibleCount,
  pending,
  outcomes,
  onPublish,
  onClear,
}: {
  selectedCount: number;
  eligibleCount: number;
  pending: boolean;
  outcomes: BatchRow[] | null;
  onPublish: () => void;
  onClear: () => void;
}) {
  if (eligibleCount === 0 && !outcomes) return null;
  if (selectedCount === 0 && !outcomes) {
    return (
      <section className="mb-3 rounded-md border border-dashed border-muted/30 px-4 py-2 text-xs text-foreground/55">
        Select up to 100 completed songs to publish in one batch (free tier
        caps at 5 public songs).
      </section>
    );
  }
  const summary = outcomes
    ? outcomes.reduce<Record<BatchOutcome, number>>(
        (acc, row) => {
          acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
          return acc;
        },
        {
          published: 0,
          already_public: 0,
          quota_hit: 0,
          not_found: 0,
          forbidden: 0,
          not_completed: 0,
        },
      )
    : null;
  return (
    <section
      role="region"
      aria-label="Bulk publish toolbar"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-4 py-3"
    >
      <div className="text-sm text-foreground/80">
        {selectedCount > 0 ? (
          <span>
            <strong>{selectedCount}</strong> song
            {selectedCount === 1 ? "" : "s"} selected
          </span>
        ) : (
          <span className="text-foreground/55">Selection cleared</span>
        )}
        {summary ? (
          <span className="ml-3 text-xs text-foreground/65">
            {summary.published > 0
              ? `published: ${summary.published} · `
              : ""}
            {summary.already_public > 0
              ? `already public: ${summary.already_public} · `
              : ""}
            {summary.quota_hit > 0
              ? `quota hit: ${summary.quota_hit} · `
              : ""}
            {summary.forbidden > 0
              ? `forbidden: ${summary.forbidden} · `
              : ""}
            {summary.not_completed > 0
              ? `not completed: ${summary.not_completed} · `
              : ""}
            {summary.not_found > 0 ? `not found: ${summary.not_found}` : ""}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPublish}
          disabled={pending || selectedCount === 0}
          className="rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-accent transition hover:bg-accent/25 disabled:opacity-40"
        >
          {pending ? "Publishing…" : "Publish selected as public"}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={pending}
          className="rounded-md border border-muted/30 px-3 py-1.5 text-xs text-foreground/60 hover:border-accent/40 hover:text-foreground disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </section>
  );
}

function RowActions({
  disabled,
  onRename,
  onDelete,
}: {
  disabled: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function onClick() {
      setOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  return (
    <div
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="rounded-md border border-muted/30 px-2 py-1 text-foreground/60 hover:border-accent/40 hover:text-foreground disabled:opacity-50"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-32 overflow-hidden rounded-md border border-muted/40 bg-background text-sm shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="block w-full px-3 py-2 text-left text-foreground/85 hover:bg-muted/20"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-red-300 hover:bg-red-400/10"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
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
