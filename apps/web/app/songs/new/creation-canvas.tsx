"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

type StyleFamily = "western" | "carnatic" | "hindustani" | "kannada-folk";
type Language = "en" | "hi" | "kn";

const STYLE_OPTIONS: { value: StyleFamily; label: string }[] = [
  { value: "western", label: "Western pop" },
  { value: "carnatic", label: "Carnatic" },
  { value: "hindustani", label: "Hindustani" },
  { value: "kannada-folk", label: "Kannada folk" },
];

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "kn", label: "Kannada" },
];

// Duration steps are constrained by the Song Document schema
// (packages/song-doc DurationSchema).
const DURATION_OPTIONS = [30, 60, 90, 180] as const;

export function CreationCanvas() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const fd = new FormData(e.currentTarget);
    const style_family = String(fd.get("style_family") ?? "western") as StyleFamily;
    const language = String(fd.get("language") ?? "en") as Language;
    const target_duration_seconds = Number(fd.get("target_duration_seconds") ?? 60);

    // Build a minimal Song Document with a single full-length verse.
    // Phase 6+ will introduce the structured creation canvas (per-section
    // editing, raga/tala pickers, etc); this is the scaffold.
    const payload = {
      song_document: {
        language,
        style_family,
        target_duration_seconds,
        sections: [
          {
            id: "v1",
            type: "verse",
            target_seconds: target_duration_seconds,
          },
        ],
      },
    };

    // Validate session client-side first so we don't burn a 401 round-trip.
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      setError("Session expired. Please sign in again.");
      return;
    }

    setStatus("Enqueueing job...");
    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as
        | { reason?: string }
        | null;
      const reason = body?.reason ?? "quota";
      setError(
        reason === "storage_bytes"
          ? "You're over your storage quota for the month."
          : "You've hit your monthly song quota. Wait until next month or upgrade.",
      );
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      setError(`Server returned ${res.status}: ${body || "(no body)"}`);
      return;
    }
    setStatus("Queued. Redirecting to library...");
    startTransition(() => {
      router.replace("/library");
      router.refresh();
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="style_family" label="Style">
          <select
            name="style_family"
            defaultValue="western"
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          >
            {STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field name="language" label="Language">
          <select
            name="language"
            defaultValue="en"
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field name="target_duration_seconds" label="Length">
        <select
          name="target_duration_seconds"
          defaultValue={60}
          className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
        >
          {DURATION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s} seconds
            </option>
          ))}
        </select>
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-accent">
          {status}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Queueing..." : "Queue song"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={name} className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-widest text-foreground/50">
        {label}
      </span>
      {children}
    </label>
  );
}
