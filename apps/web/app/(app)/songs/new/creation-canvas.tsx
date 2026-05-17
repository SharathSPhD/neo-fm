"use client";

import type { Section, SongDocument } from "@neo-fm/song-doc";
import { SONG_TITLE_MAX_CHARS } from "@neo-fm/song-doc";
import type { StylePreset } from "@neo-fm/style-presets";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

import { LibraryPicker } from "./library-picker";
import { PresetGallery } from "./preset-gallery";
import { LYRIC_MAX_CHARS, SectionEditor } from "./section-editor";

type StyleFamily =
  | "western"
  | "carnatic"
  | "hindustani"
  | "kannada-folk"
  | "kannada-light-classical"
  | "tamil-folk";
type Language = "en" | "hi" | "kn" | "ta";

const STYLE_OPTIONS: { value: StyleFamily; label: string }[] = [
  { value: "carnatic", label: "Carnatic" },
  { value: "hindustani", label: "Hindustani" },
  { value: "kannada-light-classical", label: "Kannada light-classical" },
  { value: "kannada-folk", label: "Kannada folk" },
  { value: "tamil-folk", label: "Tamil folk" },
  { value: "western", label: "Western" },
];

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "hi", label: "Hindi" },
  { value: "kn", label: "Kannada" },
  { value: "ta", label: "Tamil" },
  { value: "en", label: "English" },
];

const DURATION_OPTIONS = [30, 60, 90, 180] as const;
type Duration = (typeof DURATION_OPTIONS)[number];

const TOTAL_LYRIC_MAX_CHARS = 4000;

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

const DEFAULT_SECTION_FOR_STYLE: Record<StyleFamily, Section["type"]> = {
  carnatic: "pallavi",
  hindustani: "alaap",
  "kannada-folk": "folk_refrain",
  // Bhavageete is a poem set to a melodic frame; pallavi is the
  // natural opening section per the light-classical convention.
  "kannada-light-classical": "pallavi",
  "tamil-folk": "folk_refrain",
  western: "verse",
};

export function CreationCanvas() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [title, setTitle] = useState<string>("");
  const [activePreset, setActivePreset] = useState<StylePreset | null>(null);
  const [sections, setSections] = useState<Section[]>(() => initialSections(DEFAULT_FORM));
  const [libraryOpenFor, setLibraryOpenFor] = useState<number | null>(null);

  // Ref to the form root so that picking a preset can scroll the page to
  // the form selectors and pull keyboard focus onto the title input. The
  // ref is also handy for the e2e Playwright spec which asserts the form
  // is the active scroll target after a preset click.
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // When the global style or duration changes, regenerate the section
  // list from scratch (Sprint 2 keeps section editing simple: one
  // section per length tier; the co-composer can fan it out further if
  // the style has more structure).
  function setStyle(style_family: StyleFamily) {
    const next: FormState = { ...form, style_family };
    setForm(next);
    setSections((prev) => syncSectionsToStyle(prev, next.style_family));
    if (activePreset && activePreset.song_document.style_family !== style_family) {
      setActivePreset(null);
    }
  }
  function setLanguage(language: Language) {
    setForm({ ...form, language });
    if (activePreset && activePreset.song_document.language !== language) {
      setActivePreset(null);
    }
  }
  function setDuration(target_duration_seconds: Duration) {
    const next: FormState = { ...form, target_duration_seconds };
    setForm(next);
    setSections((prev) => rescaleSections(prev, target_duration_seconds));
    if (
      activePreset &&
      activePreset.song_document.target_duration_seconds !== target_duration_seconds
    ) {
      // Length override is allowed; we just rescale.
    }
  }

  function pickPreset(p: StylePreset) {
    const alreadyActive = activePreset?.id === p.id;
    setActivePreset(p);
    const d = p.song_document;
    const nextForm: FormState = {
      style_family: d.style_family as StyleFamily,
      language: d.language as Language,
      target_duration_seconds: d.target_duration_seconds as Duration,
    };
    setForm(nextForm);
    setSections(d.sections.map((s) => ({ ...s })));
    // Seed the title with the preset's name if the user hasn't typed
    // their own. Preserves user edits if they already entered one.
    if (!title.trim()) setTitle(p.title);
    setError(null);
    setStatus(`Loaded preset: ${p.title}`);

    // Skip scroll/focus when the user re-clicks an already-active card so
    // the page does not feel jumpy on small screens.
    if (alreadyActive) return;

    // Respect the user's motion preference. SSR-safe access via
    // typeof window.
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    // Pull keyboard focus to the next logical control (the title input)
    // on the following animation frame so the scroll has a chance to
    // begin first.
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        titleInputRef.current?.focus({ preventScroll: true });
      });
    }
  }

  const totalLyricChars = useMemo(
    () => sections.reduce((acc, s) => acc + (s.lyrics?.length ?? 0), 0),
    [sections],
  );
  const lyricsOverallCap = totalLyricChars > TOTAL_LYRIC_MAX_CHARS;

  function updateSection(idx: number, next: Section) {
    setSections((prev) => prev.map((s, i) => (i === idx ? next : s)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (lyricsOverallCap) {
      setError(
        `Total lyrics exceed ${TOTAL_LYRIC_MAX_CHARS} characters. Trim before submitting.`,
      );
      return;
    }

    const song_document = buildSongDocument(form, activePreset, sections, title);

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
    <>
      <form ref={formRef} className="flex flex-col gap-6" onSubmit={onSubmit}>
        <PresetGallery
          onPick={pickPreset}
          activeId={activePreset?.id ?? null}
        />

        <Field name="title" label="Title">
          <input
            id="title"
            ref={titleInputRef}
            name="title"
            type="text"
            value={title}
            maxLength={SONG_TITLE_MAX_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Morning Rain in Saveri"
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          />
          <span className="text-[10px] text-foreground/40">
            Optional. {SONG_TITLE_MAX_CHARS - title.length} characters left.
          </span>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="style_family" label="Style">
            <select
              name="style_family"
              value={form.style_family}
              onChange={(e) => setStyle(e.target.value as StyleFamily)}
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
              onChange={(e) => setLanguage(e.target.value as Language)}
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
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          >
            {DURATION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </Field>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-widest text-foreground/50">
              Lyrics
            </span>
            <span
              className={
                lyricsOverallCap
                  ? "text-[10px] text-red-300"
                  : "text-[10px] text-foreground/40"
              }
            >
              {totalLyricChars}/{TOTAL_LYRIC_MAX_CHARS} chars total
            </span>
          </div>
          {sections.map((s, idx) => (
            <SectionEditor
              key={s.id}
              index={idx}
              section={s}
              onChange={(next) => updateSection(idx, next)}
              onPickFromLibrary={() => setLibraryOpenFor(idx)}
            />
          ))}
        </section>

        {activePreset ? (
          <p className="rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-foreground/70">
            Using preset <strong>{activePreset.title}</strong>. The composer will
            fill in raga, tala and instrumentation from the preset; you can
            still change style/language/length and edit lyrics per section above.
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
          disabled={pending || lyricsOverallCap}
          className="self-start rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? "Queueing..." : "Queue song"}
        </button>
      </form>

      <LibraryPicker
        language={form.language}
        open={libraryOpenFor !== null}
        onClose={() => setLibraryOpenFor(null)}
        onPick={({ body, script }) => {
          if (libraryOpenFor === null) return;
          const idx = libraryOpenFor;
          // Cap the lyric body to per-section max so we never violate
          // the SectionEditor's invariant when the user picks a long
          // public-domain piece.
          const trimmed =
            body.length > LYRIC_MAX_CHARS ? body.slice(0, LYRIC_MAX_CHARS) : body;
          setSections((prev) =>
            prev.map((s, i) =>
              i === idx
                ? {
                    ...s,
                    lyrics: trimmed,
                    // Map the entry's reported script to the SongDocument
                    // script enum. The bundled corpus uses the same enum
                    // values, so this is a direct assignment.
                    script: script as Section["script"],
                  }
                : s,
            ),
          );
        }}
      />
    </>
  );
}

function initialSections(form: FormState): Section[] {
  const t = DEFAULT_SECTION_FOR_STYLE[form.style_family];
  return [
    {
      id: "s1",
      type: t,
      target_seconds: form.target_duration_seconds,
    },
  ];
}

function syncSectionsToStyle(prev: Section[], style: StyleFamily): Section[] {
  // If the user has just one default section, swap its type to the new
  // style's default; preserves any lyric content the user has typed.
  const allowedFor: Record<StyleFamily, Section["type"][]> = {
    western: ["intro", "verse", "chorus", "bridge", "outro"],
    carnatic: ["pallavi", "anupallavi", "charanam", "alaap", "sargam"],
    hindustani: ["mukhda", "antara", "saranam", "alaap", "sargam"],
    "kannada-folk": ["folk_refrain", "folk_stanza", "intro", "outro"],
    // v1.3 Sprint 2: bhavageete uses Carnatic-shaped sections (poem
    // set to a melodic frame); Tamil folk uses the same folk-stanza
    // alternation as Kannada folk.
    "kannada-light-classical": [
      "pallavi",
      "charanam",
      "anupallavi",
      "alaap",
      "intro",
      "outro",
    ],
    "tamil-folk": ["folk_refrain", "folk_stanza", "intro", "outro"],
  };
  return prev.map((s) => {
    if (allowedFor[style].includes(s.type)) return s;
    return { ...s, type: DEFAULT_SECTION_FOR_STYLE[style] };
  });
}

function rescaleSections(
  prev: Section[],
  target_total: Duration,
): Section[] {
  const orig_total = prev.reduce((acc, s) => acc + s.target_seconds, 0);
  if (orig_total === target_total) return prev;

  const next: Section[] = [];
  let assigned = 0;
  for (let i = 0; i < prev.length; i++) {
    const s = prev[i]!;
    if (i === prev.length - 1) {
      next.push({ ...s, target_seconds: target_total - assigned });
    } else {
      const share = Math.max(
        1,
        Math.round((s.target_seconds / orig_total) * target_total),
      );
      next.push({ ...s, target_seconds: share });
      assigned += share;
    }
  }
  return next;
}

/**
 * Build the Song Document to POST.
 *
 * With a preset active, we send the preset's full document (so raga,
 * orchestration etc come through), overlay the form's style/language/
 * duration, AND overlay any section edits the user has made -- including
 * lyrics picked from the library.
 *
 * Without a preset, we build a minimal document from the form +
 * edited sections.
 */
function buildSongDocument(
  form: FormState,
  preset: StylePreset | null,
  editedSections: Section[],
  title: string,
): Record<string, unknown> {
  const trimmedTitle = title.trim();
  const titleField =
    trimmedTitle.length > 0
      ? { title: trimmedTitle.slice(0, SONG_TITLE_MAX_CHARS) }
      : {};

  if (preset) {
    const base = preset.song_document;
    const styleChanged = base.style_family !== form.style_family;
    const folkStyle = form.style_family === "kannada-folk";
    return {
      ...base,
      ...(styleChanged ? { raga: undefined } : {}),
      ...(folkStyle ? { raga: undefined } : {}),
      ...titleField,
      style_family: form.style_family,
      language: form.language,
      target_duration_seconds: form.target_duration_seconds,
      sections: editedSections,
    };
  }

  return {
    ...titleField,
    style_family: form.style_family,
    language: form.language,
    target_duration_seconds: form.target_duration_seconds,
    sections: editedSections,
  };
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

export type { SongDocument };
