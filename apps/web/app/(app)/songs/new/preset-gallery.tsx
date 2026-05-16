"use client";

import { PRESETS, type StylePreset } from "@neo-fm/style-presets";

interface PresetGalleryProps {
  onPick(preset: StylePreset): void;
  /** id of the currently-applied preset (cards highlight when active). */
  activeId: string | null;
}

const STYLE_TONE: Record<string, string> = {
  carnatic: "from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/30",
  hindustani: "from-indigo-500/15 via-indigo-500/5 to-transparent border-indigo-500/30",
  "kannada-folk": "from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30",
  western: "from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/25",
};

/**
 * Card-grid of curated Song Document templates the user can pick to
 * pre-fill the creation form. Indian-origin presets land first (the
 * package's `PRESETS` export already orders them this way).
 *
 * The gallery is presentational -- it does not mutate any form state
 * itself; the parent passes `onPick` and decides what to do with the
 * preset payload. Keeping it dumb makes it easy to use in two places:
 * the creation canvas (this sprint) and, in Sprint 8, the landing page
 * "browse the styles" surface (M6).
 */
export function PresetGallery({ onPick, activeId }: PresetGalleryProps) {
  return (
    <fieldset
      aria-label="Pick a style preset"
      className="flex flex-col gap-3 rounded-lg border border-muted/20 bg-muted/10 p-4"
    >
      <legend className="text-xs uppercase tracking-widest text-foreground/50">
        Start from a preset
      </legend>
      <p className="text-sm text-foreground/60">
        Indian classical, Kannada folk, and crossover starters with raga, tala
        and instrumentation already chosen. Pick one and customise -- or skip
        and configure the form yourself.
      </p>
      <ul
        role="radiogroup"
        aria-label="Style presets"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {PRESETS.map((p) => (
          <li key={p.id}>
            <PresetCard
              preset={p}
              active={activeId === p.id}
              onPick={() => onPick(p)}
            />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function PresetCard({
  preset,
  active,
  onPick,
}: {
  preset: StylePreset;
  active: boolean;
  onPick(): void;
}) {
  const family = preset.song_document.style_family;
  const tone = STYLE_TONE[family] ?? STYLE_TONE.western;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={[
        "flex w-full flex-col gap-2 rounded-md border bg-gradient-to-b px-4 py-3 text-left transition",
        tone,
        active
          ? "ring-2 ring-accent/60"
          : "hover:border-foreground/30 hover:bg-muted/20",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{preset.title}</span>
        <span className="text-[10px] uppercase tracking-widest text-foreground/40">
          {family}
        </span>
      </div>
      <span className="text-xs text-foreground/65">{preset.subtitle}</span>
      <p className="text-xs leading-snug text-foreground/55">
        {preset.description}
      </p>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {preset.chips.map((c) => (
          <span
            key={c}
            className="rounded-full border border-foreground/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground/55"
          >
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}
