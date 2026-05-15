"use client";

import type { SongDocument } from "@neo-fm/song-doc";
import type { StylePreset } from "@neo-fm/style-presets";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

import { PresetGallery } from "./preset-gallery";

type StyleFamily = "western" | "carnatic" | "hindustani" | "kannada-folk";
type Language = "en" | "hi" | "kn";

const STYLE_OPTIONS: { value: StyleFamily; label: string }[] = [
  { value: "carnatic", label: "Carnatic" },
  { value: "hindustani", label: "Hindustani" },
  { value: "kannada-folk", label: "Kannada folk" },
  { value: "western", label: "Western" },
];

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "hi", label: "Hindi" },
  { value: "kn", label: "Kannada" },
  { value: "en", label: "English" },
];

// Duration steps are constrained by the Song Document schema
// (packages/song-doc DurationSchema).
const DURATION_OPTIONS = [30, 60, 90, 180] as const;
type Duration = (typeof DURATION_OPTIONS)[number];

interface FormState {
  style_family: StyleFamily;
  language: Language;
  target_duration_seconds: Duration;
}

const DEFAULT_FORM: FormState = {
  style_family: "carnatic",
  language: "hi",
  target_duration_seconds: 90,
};

export function CreationCanvas() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [activePreset, setActivePreset] = useState<StylePreset | null>(null);

  // When a preset is picked: lift its style/language/duration onto the
  // form so the basic controls reflect what will be submitted, then
  // remember the full preset object so we send its sections + raga + tala
  // verbatim. Picking a preset and then changing the style picker drops
  // the preset (the user has overridden the cohesive starting point).
  function pickPreset(p: StylePreset) {
    setActivePreset(p);
    const d = p.song_document;
    setForm({
      style_family: d.style_family as StyleFamily,
      language: d.language as Language,
      target_duration_seconds: d.target_duration_seconds as Duration,
    });
    setError(null);
    setStatus(`Loaded preset: ${p.title}`);
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Once the user manually changes any control, the preset's section
    // structure is no longer guaranteed to fit -- drop it. We keep the
    // currently-visible values though.
    if (activePreset) setActivePreset(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    const song_document = buildSongDocument(form, activePreset);

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
      body: JSON.stringify({ song_document }),
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
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      <PresetGallery
        onPick={pickPreset}
        activeId={activePreset?.id ?? null}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="style_family" label="Style">
          <select
            name="style_family"
            value={form.style_family}
            onChange={(e) =>
              updateForm("style_family", e.target.value as StyleFamily)
            }
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
            value={form.language}
            onChange={(e) => updateForm("language", e.target.value as Language)}
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
          value={form.target_duration_seconds}
          onChange={(e) =>
            updateForm(
              "target_duration_seconds",
              Number(e.target.value) as Duration,
            )
          }
          className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
        >
          {DURATION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s} seconds
            </option>
          ))}
        </select>
      </Field>

      {activePreset ? (
        <p className="rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-foreground/70">
          Using preset <strong>{activePreset.title}</strong>. The composer will
          fill in raga, tala and instrumentation from the preset; you can
          still change style/language/length above.
        </p>
      ) : null}

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

/**
 * Build the Song Document to POST.
 *
 * - With a preset active: send its full document, but allow the form's
 *   style/language/duration overrides to apply. The composer on the
 *   server handles the rest (raga inference, tala defaults, etc).
 * - Without a preset: build a minimal one-section document so the
 *   server-side co-composer can elaborate from scratch.
 */
function buildSongDocument(
  form: FormState,
  preset: StylePreset | null,
): Record<string, unknown> {
  if (preset) {
    const base = preset.song_document;
    // If the user changed style_family away from the preset's, drop the
    // preset's raga -- it would fail the SongDocument Zod refinement
    // (raga.system must match style_family). Same for tala on folk style.
    const styleChanged = base.style_family !== form.style_family;
    const folkStyle = form.style_family === "kannada-folk";
    const rescaled = rescaleSections(base, form.target_duration_seconds);
    return {
      ...base,
      ...(styleChanged ? { raga: undefined } : {}),
      ...(folkStyle ? { raga: undefined } : {}),
      style_family: form.style_family,
      language: form.language,
      target_duration_seconds: form.target_duration_seconds,
      sections: rescaled,
    };
  }

  return {
    style_family: form.style_family,
    language: form.language,
    target_duration_seconds: form.target_duration_seconds,
    sections: [
      {
        id: "v1",
        // Pick a section type that's legal across all styles.
        type: form.style_family === "kannada-folk" ? "folk_refrain" : "verse",
        target_seconds: form.target_duration_seconds,
      },
    ],
  };
}

/**
 * Rescale the preset's sections to fit the user's chosen total duration.
 * Proportional split, integer-rounded, with the remainder added to the
 * last section so the sum exactly matches target_duration_seconds (Zod
 * refinement enforces this).
 */
function rescaleSections(
  base: SongDocument,
  target_total: number,
): SongDocument["sections"] {
  const orig_total = base.sections.reduce((acc, s) => acc + s.target_seconds, 0);
  if (orig_total === target_total) return base.sections;

  const scaled: SongDocument["sections"] = [];
  let assigned = 0;
  for (let i = 0; i < base.sections.length; i++) {
    const s = base.sections[i]!;
    if (i === base.sections.length - 1) {
      scaled.push({ ...s, target_seconds: target_total - assigned });
    } else {
      const next = Math.max(
        1,
        Math.round((s.target_seconds / orig_total) * target_total),
      );
      scaled.push({ ...s, target_seconds: next });
      assigned += next;
    }
  }
  return scaled;
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
