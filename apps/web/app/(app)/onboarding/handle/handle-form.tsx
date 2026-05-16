"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const HANDLE_RE = /^[a-z0-9_]+$/;

export function HandleForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function validate(value: string): string | null {
    const v = value.trim();
    if (v.length < 3) return "Handle is too short (3 chars min).";
    if (v.length > 30) return "Handle is too long (30 chars max).";
    if (!HANDLE_RE.test(v)) return "Use only a-z, 0-9, and _";
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = handle.trim().toLowerCase();
    const localError = validate(v);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/account/handle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: v }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "handle_taken") {
          setError("That handle is taken. Try another.");
        } else if (data.error === "handle_reserved") {
          setError("That handle is reserved.");
        } else {
          setError(data.details ?? "Couldn't claim. Try again.");
        }
        return;
      }
      router.replace(`/u/${v}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          Handle
        </span>
        <div className="flex items-center rounded-md border border-muted/30 bg-transparent focus-within:border-accent">
          <span className="pl-3 text-foreground/40">@</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            maxLength={30}
            placeholder="ravi.kumar"
            autoFocus
            className="flex-1 bg-transparent px-2 py-2 text-base outline-none"
            required
          />
        </div>
        <span className="text-[11px] text-foreground/50">
          Lowercase letters, numbers, and underscore. 3-30 characters.
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Claim handle"}
      </button>
    </form>
  );
}
