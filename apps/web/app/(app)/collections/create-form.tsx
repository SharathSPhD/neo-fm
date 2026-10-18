"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateCollectionForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setError(
          res.status === 422
            ? "That title can't be used. Try different words."
            : res.status === 409
              ? "You have reached the collection limit."
              : "Couldn't create the collection.",
        );
        return;
      }
      const { collection } = (await res.json()) as { collection: { id: string } };
      router.push(`/collections/${collection.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        placeholder="New collection name"
        aria-label="New collection name"
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-muted/50 bg-transparent px-3"
      />
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="min-h-11 rounded-lg bg-accent px-4 text-background disabled:opacity-50"
      >
        Create
      </button>
      {error ? (
        <p role="alert" className="w-full text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
