"use client";

/**
 * v1.5: voice picker with fake-preview detection + in-browser timbre synthesis.
 *
 * 16-persona, "Suggested for <language>" + "All voices" UI. Each row
 * has a play/stop preview button that streams the 10s WAV from the
 * public `voice-samples` Supabase Storage bucket.
 *
 * If a preview WAV is the known FakeVocalModel sentinel size (960 044 bytes),
 * the component synthesises a short, clearly-labelled tone via the Web Audio
 * API instead of playing static. Real WAVs self-supersede once the DGX
 * operator runs render_voice_previews.py with real weights.
 *
 * The component is controlled: the parent (`creation-canvas`) owns the
 * selected `voice_id`. Playback state lives here.
 */
import {
  VOICE_CATALOGUE,
  type VoiceCatalogueEntry,
  type VoiceLanguage,
  voicesForLanguage,
} from "@neo-fm/co-composer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FAKE_PREVIEW_BYTES,
  isFakePreview,
  synthesiseTimbrePreview,
} from "@/lib/audio/timbre-preview";

export interface VoicePickerProps {
  /** Currently selected `voice_id` ("" = use language-default routing). */
  value: string;
  onChange: (next: string) => void;
  /** Currently selected language; drives the "Suggested" group. */
  language: VoiceLanguage;
  /** Base URL for the public voice-samples bucket. Tests pass a stub. */
  previewBaseUrl: string;
}

const NEUTRAL_OPTION = {
  voice_id: "",
  label: "Auto · Match language",
  persona: "language-default",
  gender: "androgynous" as const,
} as const;

function previewUrl(base: string, entry: VoiceCatalogueEntry): string {
  // `preview_path` is `samples/<voice_id>.wav` on disk, and the storage
  // bucket is `voice-samples`. `base` is already that bucket's public
  // CDN URL (ending in `/voice-samples`) so a simple join suffices.
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}/${entry.preview_path}`;
}

export function VoicePicker({
  value,
  onChange,
  language,
  previewBaseUrl,
}: VoicePickerProps) {
  const [playing, setPlaying] = useState<string | null>(null);
  // voice_id -> reason the most recent preview attempt failed.
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>(
    {},
  );
  // voice_ids confirmed to be fake (960 044-byte FakeVocalModel output).
  // Populated by HEAD-checks on mount; cached in sessionStorage per base URL.
  const [fakeVoiceIds, setFakeVoiceIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Pre-check all preview URLs for fake content on mount.
  useEffect(() => {
    const cacheKey = `neo-fm-fake-previews-v1:${previewBaseUrl}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        setFakeVoiceIds(new Set(JSON.parse(cached) as string[]));
      } catch {
        /* ignore corrupt cache */
      }
      return;
    }
    void Promise.all(
      VOICE_CATALOGUE.map(async (entry) => {
        const url = previewUrl(previewBaseUrl, entry);
        const fake = await isFakePreview(url, entry.voice_id, previewBaseUrl);
        return fake ? entry.voice_id : null;
      }),
    ).then((results) => {
      const fakes = results.filter((id): id is string => id !== null);
      setFakeVoiceIds(new Set(fakes));
      sessionStorage.setItem(cacheKey, JSON.stringify(fakes));
    });
  }, [previewBaseUrl]);

  // Suggested = same-language. Everything else sits under "All voices".
  const { suggested, others } = useMemo(() => {
    const sug = voicesForLanguage(language);
    const sugIds = new Set(sug.map((v) => v.voice_id));
    const all = VOICE_CATALOGUE.filter((v) => !sugIds.has(v.voice_id));
    return { suggested: sug, others: all };
  }, [language]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(null);
  }, []);

  const markFailed = useCallback((voice_id: string, reason: string) => {
    setPlaying(null);
    setPreviewErrors((prev) => ({ ...prev, [voice_id]: reason }));
  }, []);

  const clearError = useCallback((voice_id: string) => {
    setPreviewErrors((prev) => {
      if (!(voice_id in prev)) return prev;
      const next = { ...prev };
      delete next[voice_id];
      return next;
    });
  }, []);

  const togglePreview = useCallback(
    (entry: VoiceCatalogueEntry) => {
      if (playing === entry.voice_id) {
        stop();
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      clearError(entry.voice_id);

      if (fakeVoiceIds.has(entry.voice_id)) {
        // Synthesise a short timbre tone instead of playing static noise.
        // AudioContext is created here (inside the click handler) to satisfy
        // browser autoplay policies.
        setPlaying(entry.voice_id);
        synthesiseTimbrePreview(entry.gender, entry.persona, () =>
          setPlaying(null),
        );
        return;
      }

      const url = previewUrl(previewBaseUrl, entry);
      const a = new Audio(url);
      a.addEventListener("ended", () => setPlaying(null), { once: true });
      a.addEventListener(
        "error",
        () => markFailed(entry.voice_id, "Preview unavailable"),
        { once: true },
      );
      audioRef.current = a;
      void a.play().catch(() =>
        markFailed(entry.voice_id, "Preview unavailable"),
      );
      setPlaying(entry.voice_id);
    },
    [playing, previewBaseUrl, stop, markFailed, clearError, fakeVoiceIds],
  );

  // Stop any in-flight preview when the picker unmounts.
  useEffect(() => () => stop(), [stop]);

  return (
    <div className="flex flex-col gap-3" data-testid="voice-picker">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          Voice
        </span>
        {value && (
          <button
            type="button"
            className="text-[10px] text-foreground/40 underline hover:text-foreground"
            onClick={() => {
              onChange("");
              stop();
            }}
          >
            Clear
          </button>
        )}
      </div>

      <VoiceRow
        entry={NEUTRAL_OPTION}
        selected={value === ""}
        onSelect={() => {
          onChange("");
          stop();
        }}
      />

      {suggested.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[10px] uppercase tracking-widest text-foreground/40">
            Suggested for {language.toUpperCase()}
          </legend>
          {suggested.map((entry) => (
            <VoiceRow
              key={entry.voice_id}
              entry={entry}
              selected={value === entry.voice_id}
              playing={playing === entry.voice_id}
              simulated={fakeVoiceIds.has(entry.voice_id)}
              error={previewErrors[entry.voice_id]}
              onSelect={() => onChange(entry.voice_id)}
              onPreview={() => togglePreview(entry)}
            />
          ))}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[10px] uppercase tracking-widest text-foreground/40">
          All voices
        </legend>
        {others.map((entry) => (
          <VoiceRow
            key={entry.voice_id}
            entry={entry}
            selected={value === entry.voice_id}
            playing={playing === entry.voice_id}
            simulated={fakeVoiceIds.has(entry.voice_id)}
            error={previewErrors[entry.voice_id]}
            onSelect={() => onChange(entry.voice_id)}
            onPreview={() => togglePreview(entry)}
          />
        ))}
      </fieldset>
    </div>
  );
}

interface VoiceRowProps {
  entry: Pick<VoiceCatalogueEntry, "voice_id" | "label" | "persona" | "gender">;
  selected: boolean;
  playing?: boolean;
  /** True when the preview WAV is a FakeVocalModel placeholder — timbre synthesis is used instead. */
  simulated?: boolean;
  /** Inline error text when the most recent preview attempt failed. */
  error?: string;
  onSelect: () => void;
  onPreview?: () => void;
}

function VoiceRow({
  entry,
  selected,
  playing = false,
  simulated = false,
  error,
  onSelect,
  onPreview,
}: VoiceRowProps) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border px-3 py-2 transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-muted/30 hover:border-muted/60"
      }`}
      data-testid={`voice-row-${entry.voice_id || "auto"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <label className="flex flex-1 cursor-pointer items-center gap-3">
          <input
            type="radio"
            name="voice_id"
            value={entry.voice_id}
            checked={selected}
            onChange={onSelect}
            className="accent-accent"
            aria-label={entry.label}
          />
          <span className="flex flex-col">
            <span className="text-sm">{entry.label}</span>
            <span className="text-[10px] text-foreground/40">
              {entry.persona}
            </span>
          </span>
        </label>
        {onPreview && (
          <button
            type="button"
            onClick={onPreview}
            className="rounded-md border border-muted/30 px-2 py-1 text-[10px] uppercase tracking-widest text-foreground/70 hover:border-accent hover:text-accent"
            data-testid={`voice-preview-${entry.voice_id}`}
            title={simulated ? "Simulated timbre — real preview generating on DGX" : undefined}
          >
            {playing ? "Stop" : "Preview"}
          </button>
        )}
      </div>
      {/* Simulated-timbre notice — amber, not red, so it reads as informational not error. */}
      {simulated && !error && (
        <p
          className="text-[10px] text-amber-400/70"
          data-testid={`voice-preview-simulated-${entry.voice_id}`}
        >
          Simulated timbre · real preview generating
        </p>
      )}
      {/* aria-live error region for network/decode failures. */}
      <div
        role="status"
        aria-live="polite"
        className={`min-h-[14px] text-[10px] ${
          error ? "text-red-500" : "sr-only"
        }`}
        data-testid={`voice-preview-error-${entry.voice_id}`}
      >
        {error ?? ""}
      </div>
    </div>
  );
}
