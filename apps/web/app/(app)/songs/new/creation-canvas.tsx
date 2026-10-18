"use client";

import type { VoiceLanguage } from "@neo-fm/co-composer";
import type { Language } from "@neo-fm/song-doc";
import type { Section, SongDocument } from "@neo-fm/song-doc";
import { SONG_TITLE_MAX_CHARS } from "@neo-fm/song-doc";
import type { StylePreset } from "@neo-fm/style-presets";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import type { UiKey } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { createBrowserSupabase } from "@/lib/supabase/client";

import {
  AdvancedDisclosure,
  EMPTY_ADVANCED_STATE,
  parseSectionTagsRaw,
  type AdvancedState,
} from "./advanced-disclosure";
import { LibraryPicker } from "./library-picker";
import { PresetGallery } from "./preset-gallery";
import type { VoiceChoice } from "@/lib/voice";

import { PromptTab } from "./prompt-tab";
import { LYRIC_MAX_CHARS, SectionEditor } from "./section-editor";
import { VoicePicker } from "./voice-picker";

type StyleFamily =
  | "western"
  | "carnatic"
  | "hindustani"
  | "kannada-folk"
  | "kannada-light-classical"
  | "tamil-folk"
  // v1.4 Sprint 2 widening; available to advanced users even though the
  // dedicated co-composers don't ship until Sprint 14/15. Until then
  // the canvas routes them through the closest existing co-composer
  // (see `packages/co-composer/src/index.ts`).
  | "bollywood-ballad"
  | "sanskrit-shloka"
  | "bengali-rabindrasangeet"
  | "telugu-keerthana";

const STYLE_OPTIONS: { value: StyleFamily; label: UiKey }[] = [
  { value: "carnatic", label: "create.style.carnatic" },
  { value: "hindustani", label: "create.style.hindustani" },
  { value: "kannada-light-classical", label: "create.style.kannadaLight" },
  { value: "kannada-folk", label: "create.style.kannadaFolk" },
  { value: "tamil-folk", label: "create.style.tamilFolk" },
  { value: "bollywood-ballad", label: "create.style.bollywood" },
  { value: "bengali-rabindrasangeet", label: "create.style.rabindra" },
  { value: "telugu-keerthana", label: "create.style.keerthana" },
  { value: "sanskrit-shloka", label: "create.style.shloka" },
  { value: "western", label: "create.style.western" },
];

const VOICE_LANGUAGES: readonly Language[] = ["en", "hi", "kn", "ta", "te", "bn", "sa"];
function isVoiceLanguage(l: Language): l is VoiceLanguage {
  return VOICE_LANGUAGES.includes(l);
}

const LANGUAGE_OPTIONS: { value: Language; label: UiKey }[] = [
  { value: "hi", label: "create.lang.hi" },
  { value: "kn", label: "create.lang.kn" },
  { value: "ta", label: "create.lang.ta" },
  { value: "bn", label: "create.lang.bn" },
  { value: "te", label: "create.lang.te" },
  { value: "sa", label: "create.lang.sa" },
  { value: "en", label: "create.lang.en" },
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
  // v1.4 Sprint 2: bollywood-ballad follows the Western verse/chorus
  // shape; rabindrasangeet uses the Hindustani mukhda; keerthana uses
  // the Carnatic pallavi; shloka uses the dedicated shloka_verse type.
  "bollywood-ballad": "verse",
  "bengali-rabindrasangeet": "mukhda",
  "telugu-keerthana": "pallavi",
  "sanskrit-shloka": "shloka_verse",
};

type CreationMode = "compose" | "describe";

export function CreationCanvas({ firstRun = false, initialIdea, extraLanguages = [], voiceChoices }: { voiceChoices?: readonly VoiceChoice[]; firstRun?: boolean; extraLanguages?: { code: Language; name: string }[]; initialIdea?: { prompt: string; language: "hi" | "kn" | "ta" | "te" | "bn" } }) {
  const router = useRouter();
  const { t } = useUiLang();
  const [creationMode, setCreationMode] = useState<CreationMode>("describe");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [title, setTitle] = useState<string>("");
  const [activePreset, setActivePreset] = useState<StylePreset | null>(null);
  const [sections, setSections] = useState<Section[]>(() => initialSections(DEFAULT_FORM));
  const [libraryOpenFor, setLibraryOpenFor] = useState<number | null>(null);
  // v1.4 Sprint 4: advanced disclosure state. Defaults are "inherit"
  // everywhere so the simple-form path still produces the same document
  // it did in v1.3.
  const [advanced, setAdvanced] = useState<AdvancedState>(EMPTY_ADVANCED_STATE);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  // v1.4 Sprint 5: selected voice catalogue id. Empty string = "Auto"
  // (let the vocal-synth router pick by language). The picker shows
  // a "Suggested for <language>" group + a global list of all 16
  // personas, plus a 10s preview play button per row.
  const [voiceId, setVoiceId] = useState<string>("");

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
    if (!isVoiceLanguage(language)) setVoiceId("");
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
    setStatus(t("create.loadedPreset", { title: p.title }));

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

  // Live preview of the SongDocument the API will see. We rebuild on
  // every state change so the preview can't drift from the document
  // we actually POST. `useMemo` keeps the JSON.stringify cheap-ish.
  const previewJson = useMemo(() => {
    const doc = buildSongDocument(
      form,
      activePreset,
      sections,
      title,
      advanced,
      voiceId,
    );
    return JSON.stringify(doc, null, 2);
  }, [form, activePreset, sections, title, advanced, voiceId]);

  async function savePreset(defaultTitle: string) {
    setSaveStatus(null);
    setSavePending(true);
    try {
      const doc = buildSongDocument(
        form,
        activePreset,
        sections,
        title,
        advanced,
        voiceId,
      );
      const res = await fetch("/api/user-presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: (title.trim() || defaultTitle).slice(0, SONG_TITLE_MAX_CHARS),
          song_document: doc,
        }),
      });
      if (res.status === 401) {
        setSaveStatus(t("create.saveSignIn"));
        return;
      }
      if (res.status === 409) {
        setSaveStatus(t("create.saveCap"));
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as
          | { details?: { fieldErrors?: Record<string, string[]> } }
          | null;
        const firstField = body?.details?.fieldErrors
          ? Object.keys(body.details.fieldErrors)[0]
          : null;
        setSaveStatus(
          firstField
            ? t("create.saveRejectedField", { field: firstField })
            : t("create.saveRejected"),
        );
        return;
      }
      if (!res.ok) {
        const detail = await res.text();
        setSaveStatus(
          t("create.saveFailedHttp", { status: res.status, detail: detail.slice(0, 120) }),
        );
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { title?: string }
        | null;
      setSaveStatus(t("create.savedAs", { title: body?.title ?? t("create.presetWord") }));
    } catch (e) {
      setSaveStatus(t("create.saveFailedErr", { message: (e as Error).message }));
    } finally {
      setSavePending(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (lyricsOverallCap) {
      setError(t("create.errLyricsCap", { max: TOTAL_LYRIC_MAX_CHARS }));
      return;
    }

    const song_document = buildSongDocument(
      form,
      activePreset,
      sections,
      title,
      advanced,
      voiceId,
    );

    // Validate session client-side first so we don't burn a 401 round-trip.
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      setError(t("prompt.errSession"));
      return;
    }

    setStatus(t("create.enqueueing"));
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
          ? t("prompt.errStorage")
          : t("prompt.errQuota"),
      );
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      setError(t("create.errServer", { status: res.status, body: body || t("create.noBody") }));
      return;
    }
    setStatus(t("prompt.queued"));
    startTransition(() => {
      router.replace("/library");
      // No router.refresh() here: in Next 15 it cancels the replace above; navigating to a dynamic page refetches anyway.
    });
  }

  return (
    <>
      {/* Tab switcher — v1.5 PWM prompt branch */}
      <div
        role="tablist"
        aria-label={t("create.modeLabel")}
        className="flex gap-1 rounded-lg border border-muted/20 bg-muted/10 p-1 mb-4"
      >
        {(["compose", "describe"] as const).map((mode) => (
          <button
            key={mode}
            role="tab"
            type="button"
            aria-selected={creationMode === mode}
            onClick={() => setCreationMode(mode)}
            className={[
              "flex-1 rounded-md px-4 py-2 text-sm font-medium transition",
              creationMode === mode
                ? "bg-accent/15 text-accent"
                : "text-foreground/50 hover:text-foreground/80",
            ].join(" ")}
          >
            {mode === "compose" ? t("create.mode.compose") : t("create.mode.describe")}
          </button>
        ))}
      </div>

      {creationMode === "describe" ? (
        <PromptTab voiceChoices={voiceChoices} showGuide={firstRun} initialIdea={initialIdea} extraLanguages={extraLanguages} />
      ) : (
      <form ref={formRef} className="flex flex-col gap-6" onSubmit={onSubmit}>
        <PresetGallery
          onPick={pickPreset}
          activeId={activePreset?.id ?? null}
        />

        <Field name="title" label={t("create.title")}>
          <input
            id="title"
            ref={titleInputRef}
            name="title"
            type="text"
            value={title}
            maxLength={SONG_TITLE_MAX_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("create.titlePlaceholder")}
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          />
          <span className="text-[10px] text-foreground/40">
            {t("create.titleHint", { n: SONG_TITLE_MAX_CHARS - title.length })}
          </span>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="style_family" label={t("prompt.style")}>
            <select
              name="style_family"
              value={form.style_family}
              onChange={(e) => setStyle(e.target.value as StyleFamily)}
              className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
            >
              {STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Field>
          <Field name="language" label={t("prompt.language")}>
            <select
              name="language"
              value={form.language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
              {extraLanguages.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field name="target_duration_seconds" label={t("prompt.length")}>
          <select
            name="target_duration_seconds"
            value={form.target_duration_seconds}
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          >
            {DURATION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} {t("prompt.seconds")}
              </option>
            ))}
          </select>
        </Field>

        {/* Voice personas exist only for the launch languages; an expansion language sings in the model's default voice. */}
        {isVoiceLanguage(form.language) ? (
          <VoicePicker
            value={voiceId}
            onChange={setVoiceId}
            language={form.language}
            previewBaseUrl={getVoicePreviewBaseUrl()}
          />
        ) : null}

        <AdvancedDisclosure
          styleFamily={form.style_family}
          value={advanced}
          onChange={setAdvanced}
          previewJson={previewJson}
          onSaveAsPreset={savePreset}
          saveDisabled={savePending}
          saveStatus={saveStatus}
        />

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-widest text-foreground/50">
              {t("create.lyrics")}
            </span>
            <span
              className={
                lyricsOverallCap
                  ? "text-[10px] text-red-300"
                  : "text-[10px] text-foreground/40"
              }
            >
              {t("create.lyricsTotal", { n: totalLyricChars, max: TOTAL_LYRIC_MAX_CHARS })}
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
            {t("create.usingPreset.pre")}<strong>{activePreset.title}</strong>
            {t("create.usingPreset.post")}
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
          {pending ? t("prompt.queueing") : t("create.queue")}
        </button>
      </form>
      )}

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
    // v1.4 Sprint 2 additions: bollywood follows Western contour;
    // rabindrasangeet uses the Hindustani mukhda/antara/saranam frame;
    // keerthana uses Carnatic pallavi/anupallavi/charanam; shloka uses
    // the dedicated shloka_verse / shloka_refrain / phalashruti shape.
    "bollywood-ballad": ["intro", "verse", "chorus", "bridge", "outro"],
    "bengali-rabindrasangeet": ["mukhda", "antara", "saranam", "alaap"],
    "telugu-keerthana": ["pallavi", "anupallavi", "charanam"],
    "sanskrit-shloka": ["shloka_verse", "shloka_refrain", "phalashruti"],
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
 *
 * v1.4 Sprint 4: also overlays the Advanced disclosure values --
 * tempo_bpm, key (Western only, into metadata.key), raga.{name,system},
 * tala, orchestration.{lead_vocal,instruments,texture},
 * background_mix.{accompaniment_density,dynamics}, and parsed
 * section-level tags appended onto every section.
 */
export function buildSongDocument(
  form: FormState,
  preset: StylePreset | null,
  editedSections: Section[],
  title: string,
  advanced: AdvancedState = EMPTY_ADVANCED_STATE,
  voiceId: string = "",
): Record<string, unknown> {
  const trimmedTitle = title.trim();
  const titleField =
    trimmedTitle.length > 0
      ? { title: trimmedTitle.slice(0, SONG_TITLE_MAX_CHARS) }
      : {};

  let doc: Record<string, unknown>;
  if (preset) {
    const base = preset.song_document;
    const styleChanged = base.style_family !== form.style_family;
    const folkStyle = form.style_family === "kannada-folk";
    doc = {
      ...base,
      ...(styleChanged ? { raga: undefined } : {}),
      ...(folkStyle ? { raga: undefined } : {}),
      ...titleField,
      style_family: form.style_family,
      language: form.language,
      target_duration_seconds: form.target_duration_seconds,
      sections: editedSections,
    };
  } else {
    doc = {
      ...titleField,
      style_family: form.style_family,
      language: form.language,
      target_duration_seconds: form.target_duration_seconds,
      sections: editedSections,
    };
  }

  // Apply advanced overrides. Every field is "if set, otherwise leave
  // the preset / co-composer to pick". Empty inputs from the Advanced
  // disclosure stay empty so we don't clobber a preset's good defaults.
  const withAdvanced = applyAdvancedOverrides(doc, advanced, form.style_family);
  // v1.4 Sprint 5: stamp the voice catalogue id last. Empty string
  // means "use language-default routing" and we *omit* the field so
  // the Zod schema doesn't see an empty string (which fails the
  // ``min(1)`` rule).
  if (voiceId) {
    withAdvanced.voice_id = voiceId;
  } else {
    // If a preset carried a voice_id and the user cleared it, make
    // sure we don't accidentally smuggle the preset's value through.
    delete withAdvanced.voice_id;
  }
  return withAdvanced;
}

const WESTERN_STYLES_FOR_KEY = new Set(["western", "bollywood-ballad"]);

/**
 * Pure helper exported for unit tests. Folds the Advanced disclosure
 * state into a partial SongDocument. Always returns a new object;
 * never mutates the input.
 */
export function applyAdvancedOverrides(
  baseDoc: Record<string, unknown>,
  advanced: AdvancedState,
  style: string,
): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...baseDoc };

  // Tempo: numeric, clamped to the schema bounds (30-240). Anything
  // outside the range falls back to inherit so the doc validates.
  if (
    advanced.tempoBpm !== "" &&
    Number.isFinite(advanced.tempoBpm) &&
    advanced.tempoBpm >= 30 &&
    advanced.tempoBpm <= 240
  ) {
    doc.tempo_bpm = advanced.tempoBpm;
  }

  // Key: Western-only. Land in `metadata.key` (mirrors how `fork-applier`
  // stores it) so the worker can read it through one consistent path.
  if (advanced.key.trim() !== "" && WESTERN_STYLES_FOR_KEY.has(style)) {
    const metadata = (doc.metadata as Record<string, unknown> | undefined) ?? {};
    doc.metadata = { ...metadata, key: advanced.key.trim() };
  }

  // Raga: requires both name + system to be set.
  if (advanced.ragaName.trim() !== "" && advanced.ragaSystem !== "") {
    doc.raga = {
      name: advanced.ragaName.trim().toLowerCase(),
      system: advanced.ragaSystem,
    };
  }

  // Tala.
  if (advanced.tala.trim() !== "") {
    doc.tala = advanced.tala.trim();
  }

  // Orchestration.
  const orchestrationOverrides: Record<string, unknown> = {};
  if (advanced.leadVocal !== "") {
    orchestrationOverrides.lead_vocal = advanced.leadVocal;
  }
  if (advanced.instruments.length > 0) {
    orchestrationOverrides.instruments = advanced.instruments;
  }
  if (advanced.texture.trim() !== "") {
    orchestrationOverrides.texture = advanced.texture.trim();
  }
  if (Object.keys(orchestrationOverrides).length > 0) {
    const base = (doc.orchestration as Record<string, unknown> | undefined) ?? {};
    doc.orchestration = { ...base, ...orchestrationOverrides };
  }

  // Background mix.
  const mixOverrides: Record<string, unknown> = {};
  if (advanced.density !== "") {
    mixOverrides.accompaniment_density = advanced.density;
  }
  if (advanced.dynamics !== "") {
    mixOverrides.dynamics = advanced.dynamics;
  }
  if (Object.keys(mixOverrides).length > 0) {
    const base = (doc.background_mix as Record<string, unknown> | undefined) ?? {};
    doc.background_mix = { ...base, ...mixOverrides };
  }

  // Section tags: append parsed `key:value` lines to every section's
  // tag bag. tag-merge runs server-side to dedupe and resolve
  // single-valued family conflicts.
  const parsedTags = parseSectionTagsRaw(advanced.sectionTagsRaw);
  if (parsedTags.length > 0 && Array.isArray(doc.sections)) {
    doc.sections = (doc.sections as Section[]).map((s) => ({
      ...s,
      tags: [...(s.tags ?? []), ...parsedTags],
    }));
  }

  return doc;
}

/**
 * v1.4 Sprint 5: compute the public Storage URL prefix for the
 * `voice-samples` bucket. We do this client-side because the previews
 * are public, the URL is stable, and we want to avoid a server
 * round-trip per voice row. Falls back to a relative path so the
 * unit/E2E tests can serve the WAVs from a local fixture.
 */
function getVoicePreviewBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "/voice-samples";
  // Supabase public objects live at
  // <base>/storage/v1/object/public/<bucket>/<path>.
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/voice-samples`;
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
