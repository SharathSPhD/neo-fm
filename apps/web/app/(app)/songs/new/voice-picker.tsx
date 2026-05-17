"use client";

/**
 * v1.4 Sprint 5: voice picker.
 *
 * 16-persona, "Suggested for <language>" + "All voices" UI. Each row
 * has a play/stop preview button that streams the 10s WAV from the
 * public `voice-samples` Supabase Storage bucket — no extra round-trip
 * because the preview URL is the storage CDN path.
 *
 * The component is controlled: the parent (`creation-canvas`) owns the
 * selected `voice_id` and the audio element. Keeping playback state
 * here would make it awkward to pause when the user navigates away.
 */
import {
  VOICE_CATALOGUE,
  type VoiceCatalogueEntry,
  type VoiceLanguage,
  voicesForLanguage,
} from "@neo-fm/co-composer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const togglePreview = useCallback(
    (entry: VoiceCatalogueEntry) => {
      if (playing === entry.voice_id) {
        stop();
        return;
      }
      // Re-use a single Audio element so we never overlap two
      // previews; pause-then-play handles the cross-row case.
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const url = previewUrl(previewBaseUrl, entry);
      const a = new Audio(url);
      a.addEventListener("ended", () => setPlaying(null), { once: true });
      a.addEventListener(
        "error",
        () => {
          // Missing/blocked preview shouldn't break the form -- just
          // drop the playing state so the row stops showing "Stop".
          setPlaying(null);
        },
        { once: true },
      );
      audioRef.current = a;
      void a.play().catch(() => {
        // Autoplay blocked / network error / decode failure -- swallow
        // and reset state so the user can try again.
        setPlaying(null);
      });
      setPlaying(entry.voice_id);
    },
    [playing, previewBaseUrl, stop],
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
            onSelect={() => onChange(entry.voice_id)}
            onPreview={() => togglePreview(entry)}
          />
        ))}
      </fieldset>
    </div>
  );
}

interface VoiceRowProps {
  entry: Pick<VoiceCatalogueEntry, "voice_id" | "label" | "persona">;
  selected: boolean;
  playing?: boolean;
  onSelect: () => void;
  onPreview?: () => void;
}

function VoiceRow({
  entry,
  selected,
  playing = false,
  onSelect,
  onPreview,
}: VoiceRowProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-muted/30 hover:border-muted/60"
      }`}
      data-testid={`voice-row-${entry.voice_id || "auto"}`}
    >
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
        >
          {playing ? "Stop" : "Preview"}
        </button>
      )}
    </div>
  );
}
