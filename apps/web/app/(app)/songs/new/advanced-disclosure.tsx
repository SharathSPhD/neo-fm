"use client";

/**
 * v1.4 Sprint 4: Advanced disclosure for the creation canvas.
 *
 * Surfaces every SongDocument knob that the simple form hides — tempo,
 * key, raga, tala, orchestration, mix, free-form section tags — and a
 * live JSON preview of the resulting Song Document. Mirrors the
 * Suno-Custom + Udio-Advanced affordances but stays SongDocument-shaped
 * so the worker doesn't need a translation layer.
 *
 * The component is purely controlled: the parent (`creation-canvas`)
 * owns the state and passes the current values + setters. Keeping it
 * thin means the parent stays the single source of truth for
 * `buildSongDocument`.
 */
import {
  INSTRUMENT_CATALOGUE,
  RAGA_CATALOGUE,
  type RagaSystem,
  ragasForStyle,
  talasForSystem,
} from "@neo-fm/co-composer";
import { useState } from "react";

export interface AdvancedState {
  /** Tempo in BPM. 0 / undefined = inherit from preset / co-composer. */
  tempoBpm: number | "";
  /** Western key like "C", "F#m". Empty = inherit; valid only on Western. */
  key: string;
  /** Raga name (lowercase canonical or user-typed). Empty = inherit. */
  ragaName: string;
  /** Raga system. Empty = inherit. */
  ragaSystem: RagaSystem | "";
  /** Tala name (lowercase canonical). Empty = inherit. */
  tala: string;
  /** Selected lead-vocal. "" = inherit. */
  leadVocal: "" | "male" | "female" | "instrumental";
  /** Selected instruments (from INSTRUMENT_CATALOGUE + custom). */
  instruments: string[];
  /** Texture free-form ("layered", "sparse", "polyphonic", ...). */
  texture: string;
  /** Background-mix density radio. */
  density: "" | "sparse" | "balanced" | "dense";
  /** Background-mix dynamics radio. */
  dynamics: "" | "calm" | "balanced" | "energetic";
  /** Free-form section tags, e.g. "mood:bright". Stored as raw text; the
   * parent splits and validates on submit. */
  sectionTagsRaw: string;
}

export const EMPTY_ADVANCED_STATE: AdvancedState = {
  tempoBpm: "",
  key: "",
  ragaName: "",
  ragaSystem: "",
  tala: "",
  leadVocal: "",
  instruments: [],
  texture: "",
  density: "",
  dynamics: "",
  sectionTagsRaw: "",
};

const WESTERN_STYLES = new Set(["western", "bollywood-ballad"]);
const WESTERN_KEYS = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
const WESTERN_MODES = ["major", "minor"] as const;

export interface AdvancedDisclosureProps {
  styleFamily: string;
  value: AdvancedState;
  onChange: (next: AdvancedState) => void;
  /** Preview JSON snapshot rendered next to the controls. */
  previewJson: string;
  /** Called when the user clicks "Save as my preset". */
  onSaveAsPreset?: (defaultTitle: string) => void;
  /** Disable the save button while saving / when no user etc. */
  saveDisabled?: boolean;
  /** Last save status message ("Saved as X", "Cap reached: 20", null). */
  saveStatus?: string | null;
}

export function AdvancedDisclosure({
  styleFamily,
  value,
  onChange,
  previewJson,
  onSaveAsPreset,
  saveDisabled,
  saveStatus,
}: AdvancedDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const isWestern = WESTERN_STYLES.has(styleFamily);
  const ragaOptions = ragasForStyle(styleFamily);
  const supportsRaga = ragaOptions.length > 0;
  const talaOptions = talasForSystem(
    value.ragaSystem === "" ? undefined : value.ragaSystem,
  );
  const instruments = INSTRUMENT_CATALOGUE[styleFamily] ?? [];

  function set<K extends keyof AdvancedState>(
    key: K,
    next: AdvancedState[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  function toggleInstrument(name: string) {
    const set_ = new Set(value.instruments);
    if (set_.has(name)) set_.delete(name);
    else set_.add(name);
    onChange({ ...value, instruments: Array.from(set_) });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-muted/20 bg-muted/5 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between text-left"
        aria-expanded={expanded}
        aria-controls="advanced-controls"
      >
        <span className="text-xs font-medium uppercase tracking-widest text-foreground/70">
          Advanced
        </span>
        <span className="text-[10px] text-foreground/40">
          {expanded ? "Hide" : "Show"} tempo · key · raga · tala · mix
        </span>
      </button>

      {expanded ? (
        <div id="advanced-controls" className="flex flex-col gap-4">
          <p className="text-[11px] text-foreground/50">
            Leave a field empty to inherit from the preset / co-composer.
            Filled fields override the suggestion and are passed verbatim
            to the worker.
          </p>

          {/* Tempo + Key */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Tempo (BPM)
              </span>
              <input
                type="number"
                min={60}
                max={180}
                value={value.tempoBpm}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") set("tempoBpm", "");
                  else {
                    const n = Number.parseInt(raw, 10);
                    set("tempoBpm", Number.isFinite(n) ? n : "");
                  }
                }}
                placeholder="(inherit)"
                className="rounded-md border border-muted/30 bg-transparent px-2 py-1 font-mono text-xs"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Key {isWestern ? "" : "(Western-only)"}
              </span>
              <select
                value={value.key}
                onChange={(e) => set("key", e.target.value)}
                disabled={!isWestern}
                className="rounded-md border border-muted/30 bg-transparent px-2 py-1 font-mono text-xs disabled:opacity-50"
              >
                <option value="">(inherit)</option>
                {WESTERN_KEYS.map((k) =>
                  WESTERN_MODES.map((m) => (
                    <option key={`${k}-${m}`} value={`${k}${m === "minor" ? "m" : ""}`}>
                      {k} {m}
                    </option>
                  )),
                )}
              </select>
            </label>
          </div>

          {/* Raga + Tala */}
          {supportsRaga ? (
            <fieldset className="grid grid-cols-3 gap-3">
              <label className="col-span-2 flex flex-col gap-1 text-xs">
                <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                  Raga
                </span>
                <select
                  value={value.ragaName}
                  onChange={(e) => {
                    const name = e.target.value;
                    set("ragaName", name);
                    // Auto-fill system + suggested tala when picking a
                    // catalogue raga; clear them on free-form.
                    if (name === "") {
                      set("ragaSystem", "");
                      return;
                    }
                    const found = RAGA_CATALOGUE.find((r) => r.name === name);
                    if (found) {
                      onChange({
                        ...value,
                        ragaName: name,
                        ragaSystem: found.system,
                        tala: found.suggestedTala ?? value.tala,
                      });
                    }
                  }}
                  className="rounded-md border border-muted/30 bg-transparent px-2 py-1 text-xs"
                >
                  <option value="">(inherit)</option>
                  {ragaOptions.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.label} — {r.mood ?? r.system}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                  Tala
                </span>
                <select
                  value={value.tala}
                  onChange={(e) => set("tala", e.target.value)}
                  className="rounded-md border border-muted/30 bg-transparent px-2 py-1 text-xs"
                >
                  <option value="">(inherit)</option>
                  {talaOptions.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ) : null}

          {/* Orchestration */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[10px] uppercase tracking-widest text-foreground/40">
              Orchestration
            </legend>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-foreground/60">Lead vocal:</span>
              {(
                [
                  ["", "(inherit)"],
                  ["male", "male"],
                  ["female", "female"],
                  ["instrumental", "instrumental"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="lead-vocal"
                    value={k}
                    checked={value.leadVocal === k}
                    onChange={() =>
                      set("leadVocal", k as AdvancedState["leadVocal"])
                    }
                  />
                  {l}
                </label>
              ))}
            </div>

            {instruments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {instruments.map((i) => {
                  const active = value.instruments.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleInstrument(i)}
                      className={`rounded-full border px-2 py-1 text-[11px] transition ${
                        active
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-muted/30 text-foreground/70 hover:border-accent/30"
                      }`}
                    >
                      {i}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Texture
              </span>
              <input
                type="text"
                value={value.texture}
                onChange={(e) => set("texture", e.target.value)}
                placeholder="(inherit, e.g. layered)"
                className="rounded-md border border-muted/30 bg-transparent px-2 py-1 text-xs"
                maxLength={32}
              />
            </label>
          </fieldset>

          {/* Background mix */}
          <fieldset className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Accompaniment density
              </span>
              <div className="flex gap-3 text-xs">
                {(["sparse", "balanced", "dense"] as const).map((d) => (
                  <label key={d} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="density"
                      value={d}
                      checked={value.density === d}
                      onChange={() => set("density", d)}
                    />
                    {d}
                  </label>
                ))}
                {value.density !== "" ? (
                  <button
                    type="button"
                    onClick={() => set("density", "")}
                    className="text-foreground/40 underline"
                  >
                    clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Dynamics
              </span>
              <div className="flex gap-3 text-xs">
                {(["calm", "balanced", "energetic"] as const).map((d) => (
                  <label key={d} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="dynamics"
                      value={d}
                      checked={value.dynamics === d}
                      onChange={() => set("dynamics", d)}
                    />
                    {d}
                  </label>
                ))}
                {value.dynamics !== "" ? (
                  <button
                    type="button"
                    onClick={() => set("dynamics", "")}
                    className="text-foreground/40 underline"
                  >
                    clear
                  </button>
                ) : null}
              </div>
            </div>
          </fieldset>

          {/* Section tags */}
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[10px] uppercase tracking-widest text-foreground/40">
              Section tags
            </span>
            <textarea
              rows={3}
              value={value.sectionTagsRaw}
              onChange={(e) => set("sectionTagsRaw", e.target.value)}
              placeholder={
                "one tag per line. e.g.\nmood:bright\ncrowd:wedding"
              }
              className="rounded-md border border-muted/30 bg-transparent px-2 py-1 font-mono text-xs"
              maxLength={1024}
            />
            <span className="text-[10px] text-foreground/40">
              Free-form `key:value` strings, one per line. Anything that
              matches a single-valued composer family (raga, tala, key,
              tempo, …) overrides the composer&apos;s suggestion via
              tag-merge.
            </span>
          </label>

          {/* JSON preview */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-foreground/40">
              Song document preview
            </span>
            <pre
              aria-label="Song document JSON preview"
              className="max-h-48 overflow-auto rounded-md border border-muted/20 bg-muted/10 p-2 font-mono text-[10px] leading-tight"
            >
              {previewJson}
            </pre>
          </div>

          {/* Save as preset */}
          {onSaveAsPreset ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={saveDisabled}
                onClick={() =>
                  onSaveAsPreset(
                    `${styleFamily} preset (${new Date().toLocaleDateString()})`,
                  )
                }
                className="self-start rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                Save as my preset
              </button>
              {saveStatus ? (
                <span className="text-[10px] text-foreground/50">{saveStatus}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Parse the free-form tags textarea into an array of trimmed,
 * non-empty `key:value` strings. Caller side-effect free.
 *
 * Empty input → []. Lines without a `:` are skipped (we don't want to
 * silently send free-form prose to the tag-merge layer, which only
 * understands `key:value`).
 */
export function parseSectionTagsRaw(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes(":"));
}
