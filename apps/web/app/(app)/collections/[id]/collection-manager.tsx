"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePlayer, queueAudioUrlPath } from "@/components/player/player-provider";
import type { CollectionSong } from "@/lib/collections/load";
import { buildSharePayload } from "@/lib/share/card";

interface Props {
  collection: {
    id: string;
    title: string;
    description: string | null;
    visibility: "private" | "unlisted" | "public";
    publicId: string;
  };
  songs: CollectionSong[];
}

const VIS = [
  { value: "private", label: "Private", hint: "Only you" },
  { value: "unlisted", label: "Link only", hint: "Anyone with the link" },
  { value: "public", label: "Public", hint: "Anyone with the link, discoverable" },
] as const;

export function CollectionManager({ collection, songs: initialSongs }: Props) {
  const router = useRouter();
  const player = usePlayer();
  const [songs, setSongs] = useState(initialSongs);
  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description ?? "");
  const [visibility, setVisibility] = useState(collection.visibility);
  const [saved, setSaved] = useState({ title: collection.title, description: collection.description ?? "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/c/${collection.publicId}` : `/c/${collection.publicId}`;
  const dirty = title.trim() !== saved.title || description.trim() !== saved.description;

  function play(start: number) {
    player.playQueue(
      songs.map((s) => ({
        songId: s.jobId,
        title: s.title,
        subtitle: collection.title,
        publicId: s.publicId,
        refreshPath: queueAudioUrlPath({ songId: s.jobId, publicId: s.publicId }, s.owned),
      })),
      start,
    );
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 422) {
        setMessage("That text can't be used. Try different words.");
        return false;
      }
      if (!res.ok) {
        setMessage("Couldn't save changes.");
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (await patch({ title, description })) {
      setSaved({ title: title.trim(), description: description.trim() });
      setMessage("Saved.");
      router.refresh();
    }
  }

  async function changeVisibility(v: Props["collection"]["visibility"]) {
    const prev = visibility;
    setVisibility(v);
    if (!(await patch({ visibility: v }))) setVisibility(prev);
  }

  async function remove(jobId: string) {
    const res = await fetch(`/api/collections/${collection.id}/items/${jobId}`, { method: "DELETE" });
    if (res.ok) setSongs((s) => s.filter((x) => x.jobId !== jobId));
    else setMessage("Couldn't remove that song.");
  }

  async function destroy() {
    if (!window.confirm(`Delete "${collection.title}"? The songs themselves are not deleted.`)) return;
    const res = await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
    if (res.ok) router.push("/collections");
    else setMessage("Couldn't delete the collection.");
  }

  async function share() {
    const payload = buildSharePayload(collection.title, shareUrl);
    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage("Link copied.");
    } catch {
      setMessage(shareUrl);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          aria-label="Collection title"
          className="rounded-lg border border-transparent bg-transparent text-3xl font-medium tracking-tight hover:border-muted/40 focus:border-accent focus:outline-hidden"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="Add a description (optional)"
          aria-label="Collection description"
          className="rounded-lg border border-muted/40 bg-transparent p-2 text-sm"
        />
        {dirty ? (
          <button
            type="button"
            onClick={() => void saveDetails()}
            disabled={busy || !title.trim()}
            className="min-h-11 w-fit rounded-lg bg-accent px-4 text-background disabled:opacity-50"
          >
            Save changes
          </button>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => play(0)}
          disabled={songs.length === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-background disabled:opacity-50"
        >
          <span aria-hidden>▶</span> Play all
        </button>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Who can see this collection</legend>
          {VIS.map((o) => (
            <label
              key={o.value}
              title={o.hint}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-3 text-sm ${
                visibility === o.value ? "border-accent text-accent" : "border-muted/50"
              }`}
            >
              <input
                type="radio"
                name="visibility"
                className="sr-only"
                checked={visibility === o.value}
                onChange={() => void changeVisibility(o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        {visibility !== "private" ? (
          <>
            <button
              type="button"
              onClick={() => void share()}
              className="min-h-11 rounded-lg border border-muted/50 px-3 text-sm hover:border-accent"
            >
              Share…
            </button>
            <Link
              href={`/c/${collection.publicId}`}
              className="text-sm text-accent underline underline-offset-4"
            >
              View public page
            </Link>
          </>
        ) : null}
      </section>
      {visibility !== "private" ? (
        <p className="text-xs text-foreground/55">
          Only songs you&apos;ve published (public or link-only) show on the shared page. Private songs stay
          hidden from everyone else.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-foreground/70">
          {message}
        </p>
      ) : null}

      {songs.length === 0 ? (
        <p className="text-sm text-foreground/60">
          Nothing here yet. Open any song and choose &quot;Add to collection&quot;.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-muted/20 rounded-xl border border-muted/30">
          {songs.map((s, i) => {
            const current = player.track?.songId === s.jobId;
            return (
              <li key={s.jobId} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => (current ? player.toggle() : play(i))}
                  aria-label={`Play ${s.title}`}
                  className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-muted/50"
                >
                  <span aria-hidden>{current && player.playing ? "❚❚" : "▶"}</span>
                </button>
                <Link
                  href={s.owned ? `/songs/${s.jobId}` : `/s/${s.publicId}`}
                  className="min-w-0 flex-1"
                >
                  <span className={`block truncate text-sm ${current ? "text-accent" : ""}`}>
                    {i + 1}. {s.title}
                  </span>
                  <span className="block truncate text-xs text-foreground/55">
                    {[s.language, s.style, s.owned ? null : "by someone else"].filter(Boolean).join(" · ")}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void remove(s.jobId)}
                  aria-label={`Remove ${s.title}`}
                  className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-foreground/60 hover:text-foreground"
                >
                  <span aria-hidden>✕</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <button
        type="button"
        onClick={() => void destroy()}
        className="min-h-11 w-fit rounded-lg border border-red-400/50 px-3 text-sm text-red-400"
      >
        Delete collection
      </button>
    </div>
  );
}
