"use client";

import type { Section } from "@neo-fm/song-doc";
import { useId } from "react";

/**
 * M2 per-section lyric editor.
 *
 * Renders one section row with:
 *   - section title (read-only label, derived from section.type + index)
 *   - script picker (Devanagari / Kannada / Tamil / Telugu / Bengali / Latin)
 *   - lyrics textarea (length-capped client-side so the user gets immediate
 *     feedback; the server enforces the same cap in Sprint 4)
 *   - duration display (read-only here; duration is controlled by the
 *     creation canvas's total-length picker via rescaleSections)
 *
 * The editor is fully controlled: the parent owns the sections array and
 * passes change callbacks down. We don't push raw DOM state up; the
 * parent's setState is the single source of truth for what gets submitted.
 *
 * Length caps mirror the Sprint 4 plan:
 *   - per-section: 1000 chars
 *   - per-section (overrun warning): 800 chars
 * The hard cap is enforced via `maxLength` on the textarea so the user
 * cannot type more than 1000 chars even if they bypass the warning.
 */

const SCRIPTS = ["devanagari", "kannada", "tamil", "telugu", "bengali", "latin"] as const;
type Script = (typeof SCRIPTS)[number];

const SCRIPT_LABEL: Record<Script, string> = {
  devanagari: "Devanagari (\u0905\u0906)",
  kannada: "Kannada (\u0c85\u0c86)",
  tamil: "Tamil (\u0b85\u0b86)",
  telugu: "Telugu (\u0c05\u0c06)",
  bengali: "Bengali (\u0985\u0986)",
  latin: "Latin (Aa)",
};

export const LYRIC_MAX_CHARS = 1000;
export const LYRIC_WARN_CHARS = 800;

const SECTION_LABEL: Record<string, string> = {
  intro: "Intro",
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  outro: "Outro",
  pallavi: "Pallavi",
  anupallavi: "Anupallavi",
  charanam: "Charanam",
  mukhda: "Mukhda",
  antara: "Antara",
  saranam: "Saranam",
  alaap: "\u0100lap",
  sargam: "Sargam",
  folk_refrain: "Folk refrain",
  folk_stanza: "Folk stanza",
};

export type EditableSection = Section;

export interface SectionEditorProps {
  index: number;
  section: EditableSection;
  onChange: (next: EditableSection) => void;
  onPickFromLibrary: () => void;
}

export function SectionEditor({
  index,
  section,
  onChange,
  onPickFromLibrary,
}: SectionEditorProps) {
  const labelId = useId();
  const scriptId = useId();
  const lyricsLen = section.lyrics?.length ?? 0;
  const warn = lyricsLen >= LYRIC_WARN_CHARS;
  const over = lyricsLen >= LYRIC_MAX_CHARS;

  return (
    <fieldset
      aria-labelledby={labelId}
      className="flex flex-col gap-3 rounded-md border border-muted/30 bg-muted/5 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            id={labelId}
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            {SECTION_LABEL[section.type] ?? section.type} #{index + 1}
          </span>
          <span className="text-[10px] text-foreground/40">
            ({section.target_seconds}s)
          </span>
        </div>
        <button
          type="button"
          onClick={onPickFromLibrary}
          className="rounded-md border border-accent/30 px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
        >
          Pick from library
        </button>
      </div>

      <label htmlFor={scriptId} className="flex items-center gap-2 text-xs">
        <span className="text-foreground/50">Script:</span>
        <select
          id={scriptId}
          value={section.script ?? "latin"}
          onChange={(e) =>
            onChange({ ...section, script: e.target.value as Script })
          }
          className="rounded-md border border-muted/30 bg-transparent px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {SCRIPTS.map((s) => (
            <option key={s} value={s}>
              {SCRIPT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <textarea
        value={section.lyrics ?? ""}
        onChange={(e) =>
          onChange({
            ...section,
            // Hard cap on input length. UI also surfaces a warning at
            // LYRIC_WARN_CHARS so the user has time to trim before hitting
            // the wall.
            lyrics: e.target.value.slice(0, LYRIC_MAX_CHARS),
          })
        }
        rows={4}
        placeholder={
          section.script === "devanagari"
            ? "\u0938\u0902\u0917\u0940\u0924 \u0915\u0947 \u092C\u094B\u0932..."
            : section.script === "kannada"
              ? "\u0CB9\u0CBE\u0CA1\u0BBF\u0CA8 \u0CB8\u0CBE\u0CB9\u0CBF\u0CA4\u0BCD\u0BAF..."
              : "Lyrics for this section..."
        }
        className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
      />
      <div className="flex items-center justify-between text-[10px]">
        <span
          className={
            over
              ? "text-red-300"
              : warn
                ? "text-amber-300"
                : "text-foreground/40"
          }
        >
          {lyricsLen}/{LYRIC_MAX_CHARS}
        </span>
        {section.transliteration ? (
          <span className="text-foreground/40">
            Romanization on submit → carried as transliteration
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}
