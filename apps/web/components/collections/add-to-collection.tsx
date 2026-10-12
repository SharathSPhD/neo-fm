"use client";

/**
 * "Add to collection" popover for a song. Lists the caller's collections
 * with a toggle each, plus a quick "new collection" row. Works on the
 * owner's song page and on public song pages (signed-out visitors are sent
 * to sign in).
 */
import Link from "next/link";
import { useState } from "react";

interface Row {
  id: string;
  title: string;
  visibility: string;
  count: number;
  has_song?: boolean;
}

export function AddToCollectionButton({
  jobId,
  signedIn = true,
  nextPath,
}: {
  jobId: string;
  signedIn?: boolean;
  /** Where to return after sign-in (public pages). */
  nextPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  async function openPanel() {
    setOpen(true);
    setError(null);
    if (!signedIn) return;
    try {
      const res = await fetch(`/api/collections?job=${jobId}`, { cache: "no-store" });
      if (res.status === 401) {
        setError("Sign in to save songs to collections.");
        return;
      }
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { collections: Row[] };
      setRows(j.collections);
    } catch {
      setError("Couldn't load your collections.");
    }
  }

  async function toggle(row: Row) {
    setBusy(row.id);
    setError(null);
    try {
      const res = row.has_song
        ? await fetch(`/api/collections/${row.id}/items/${jobId}`, { method: "DELETE" })
        : await fetch(`/api/collections/${row.id}/items`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
      if (!res.ok) {
        setError(
          res.status === 409 ? "This collection is full." : "Couldn't update the collection.",
        );
        return;
      }
      setRows((rs) =>
        (rs ?? []).map((r) =>
          r.id === row.id
            ? { ...r, has_song: !row.has_song, count: r.count + (row.has_song ? -1 : 1) }
            : r,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.status === 422) {
        setError("That title can't be used. Try different words.");
        return;
      }
      if (!res.ok) {
        setError(res.status === 409 ? "You have reached the collection limit." : "Couldn't create it.");
        return;
      }
      const { collection } = (await res.json()) as { collection: { id: string; title: string; visibility: string } };
      const add = await fetch(`/api/collections/${collection.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      setRows((rs) => [
        { id: collection.id, title: collection.title, visibility: collection.visibility, count: add.ok ? 1 : 0, has_song: add.ok },
        ...(rs ?? []),
      ]);
      if (!add.ok) setError("Created, but couldn't add this song.");
      setNewTitle("");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void openPanel())}
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-muted/50 px-3 py-2 text-sm hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden>＋</span> Add to collection
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Add to collection"
          className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-muted/40 bg-background p-3 shadow-xl"
        >
          {!signedIn ? (
            <p className="text-sm">
              <Link
                href={`/sign-in?next=${encodeURIComponent(nextPath ?? "/library")}`}
                className="text-accent underline underline-offset-4"
              >
                Sign in
              </Link>{" "}
              to save songs to your collections.
            </p>
          ) : (
            <>
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {(rows ?? []).map((r) => (
                  <li key={r.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/20">
                      <input
                        type="checkbox"
                        checked={!!r.has_song}
                        disabled={busy === r.id}
                        onChange={() => void toggle(r)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                      <span className="text-xs text-foreground/50">
                        {r.visibility === "private" ? "private" : r.visibility}
                      </span>
                    </label>
                  </li>
                ))}
                {rows && rows.length === 0 ? (
                  <li className="px-2 py-1 text-sm text-foreground/60">No collections yet.</li>
                ) : null}
              </ul>
              <form onSubmit={createAndAdd} className="mt-2 flex gap-2 border-t border-muted/30 pt-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={80}
                  placeholder="New collection"
                  aria-label="New collection title"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-muted/50 bg-transparent px-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy === "new" || newTitle.trim().length === 0}
                  className="min-h-11 rounded-md bg-accent px-3 text-sm text-background disabled:opacity-50"
                >
                  Create
                </button>
              </form>
              <Link
                href="/collections"
                className="mt-2 block text-xs text-foreground/60 underline underline-offset-4"
              >
                Manage collections
              </Link>
            </>
          )}
          {error ? (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
