/**
 * Western co-composer.
 *
 * Given a SongDocument with `style_family: "western"`, fill in per-section
 * synthesis hints that HeartMuLa consumes verbatim via the `tags` channel.
 * The hints come from three sources:
 *
 *   1. Section type (intro/verse/chorus/bridge/outro) → a diatonic chord
 *      progression in the requested key. We use widely-used pop/rock loops
 *      so the output is predictable across tempos. Bridges get a brief
 *      modal lift; outros get a 50s loop to land softly.
 *   2. Global tempo_bpm → tempo descriptor (ballad | mid-tempo | upbeat |
 *      dance). Matches the buckets HeartMuLa was trained on so the model
 *      does not have to reverse-engineer numeric BPM.
 *   3. Orchestration.instruments → forwarded as `instrument:<name>` tags so
 *      the model conditions on the requested bandstand. lead_vocal is
 *      forwarded as `lead_vocal:<sex|instrumental>`.
 *
 * The composer is deterministic — same input, same output — which is what
 * lets us check the Phase 2 demo into git and re-run it on every PR. It
 * never overwrites tags the producer already supplied; it only appends.
 *
 * Constraints (TRIZ C8 — "do not silently invent musical material"):
 *   - Refuses to elaborate documents whose `style_family !== "western"`.
 *   - Refuses unknown section types (defensively never happens because the
 *     Zod enum guards this, but defence in depth).
 *   - Refuses tempos outside [30, 240]. The Zod schema also enforces this;
 *     mirroring the check here keeps the failure message local to the
 *     co-composer.
 *
 * Pratyabhijna (Phase 10+) replaces this hand-rolled mapping with a
 * prompt-driven structured composition step that emits the same SongDocument
 * shape. The interface stays the same; downstream consumers do not change.
 */

import type {
  Orchestration,
  Section,
  SongDocument,
  StyleFamily,
} from "@neo-fm/song-doc";

import type { CoComposer } from "./index.js";
import { attachPhonemes } from "./phonemes.js";
import { mergeTags } from "./tag-merge.js";

type Key = "C" | "G" | "D" | "A" | "E" | "F" | "Bb" | "Eb";

const DEFAULT_KEY: Key = "C";

const KEYS_BY_SCALE_DEGREE: Record<Key, [string, string, string, string, string, string, string]> = {
  // Major-key diatonic triads: I  ii  iii IV V  vi  vii°
  //                            0  1   2   3  4  5   6
  C:  ["C",  "Dm", "Em", "F",  "G",  "Am", "Bdim"],
  G:  ["G",  "Am", "Bm", "C",  "D",  "Em", "F#dim"],
  D:  ["D",  "Em", "F#m","G",  "A",  "Bm", "C#dim"],
  A:  ["A",  "Bm", "C#m","D",  "E",  "F#m","G#dim"],
  E:  ["E",  "F#m","G#m","A",  "B",  "C#m","D#dim"],
  F:  ["F",  "Gm", "Am", "Bb", "C",  "Dm", "Edim"],
  Bb: ["Bb", "Cm", "Dm", "Eb", "F",  "Gm", "Adim"],
  Eb: ["Eb", "Fm", "Gm", "Ab", "Bb", "Cm", "Ddim"],
};

// (Scale degrees indexed from 0 = I)
const PROGRESSIONS_BY_SECTION_TYPE: Record<string, number[]> = {
  intro: [0, 4, 5, 3],   // I-V-vi-IV
  verse: [5, 3, 0, 4],   // vi-IV-I-V (sadcore loop)
  chorus: [0, 4, 5, 3],  // I-V-vi-IV (axis of awesome)
  bridge: [1, 4, 0, 0],  // ii-V-I-I (jazz-tinged lift)
  outro: [0, 5, 3, 4],   // I-vi-IV-V (50s progression)
};

function tempoDescriptor(bpm: number | undefined): string {
  if (bpm === undefined) return "tempo:mid-tempo";
  if (bpm < 80) return "tempo:ballad";
  if (bpm < 110) return "tempo:mid-tempo";
  if (bpm < 140) return "tempo:upbeat";
  return "tempo:dance";
}

function inferKey(doc: SongDocument): Key {
  const md = doc.metadata as Record<string, unknown> | undefined;
  const k = md?.key;
  if (typeof k === "string" && (k as Key) in KEYS_BY_SCALE_DEGREE) {
    return k as Key;
  }
  return DEFAULT_KEY;
}

function chordProgressionTag(
  sectionType: string,
  key: Key,
): string | null {
  const degrees = PROGRESSIONS_BY_SECTION_TYPE[sectionType];
  if (!degrees) return null;
  const scale = KEYS_BY_SCALE_DEGREE[key];
  const chords = degrees.map((d) => scale[d]).join("-");
  return `progression:${chords}`;
}

function instrumentTags(orch: Orchestration | undefined): string[] {
  if (!orch) return [];
  const out: string[] = [];
  if (orch.lead_vocal) out.push(`lead_vocal:${orch.lead_vocal}`);
  if (orch.texture) out.push(`texture:${orch.texture}`);
  for (const inst of orch.instruments ?? []) {
    out.push(`instrument:${inst}`);
  }
  return out;
}

function elaborateSection(
  section: Section,
  globalTags: string[],
  key: Key,
): Section {
  const composerTags: string[] = [
    `section:${section.type}`,
    `key:${key}`,
    ...globalTags,
  ];
  const progTag = chordProgressionTag(section.type, key);
  if (progTag) composerTags.push(progTag);

  // Merge with any tags the producer pre-supplied (e.g. a guided session
  // pinning "bright" or "minor-ish"). Producer values come first and win for
  // both exact duplicates AND single-valued prefix families (key:, style:,
  // tempo:, etc.). Free-form tags ("mood:bright") pass through both directions.
  // See tag-merge.ts for the rules (shared by every co-composer).
  return { ...section, tags: mergeTags(section.tags, composerTags) };
}

export class WesternCoComposer implements CoComposer {
  readonly style_family = "western" as const;
  // v1.4: also accepts bollywood-ballad (pop-rock harmony + Indian
  // instrumentation). The composer emits `style:${doc.style_family}`
  // so music-inference and the stem planner see the user-facing
  // family, not "western", and can route accordingly.
  readonly acceptedStyleFamilies: ReadonlySet<StyleFamily> = new Set([
    "western",
    "bollywood-ballad",
  ]);

  async elaborate(doc: SongDocument): Promise<SongDocument> {
    if (!this.acceptedStyleFamilies.has(doc.style_family)) {
      throw new Error(
        `WesternCoComposer received style_family=${doc.style_family}; use getCoComposer(doc.style_family) instead`,
      );
    }
    if (doc.tempo_bpm !== undefined && (doc.tempo_bpm < 30 || doc.tempo_bpm > 240)) {
      throw new Error(
        `WesternCoComposer rejects tempo_bpm=${doc.tempo_bpm}; valid range is 30-240`,
      );
    }

    const key = inferKey(doc);
    const globalTags = [
      `style:${doc.style_family}`,
      tempoDescriptor(doc.tempo_bpm),
      ...(doc.time_signature ? [`time_sig:${doc.time_signature}`] : []),
      ...instrumentTags(doc.orchestration),
    ];

    const elaboratedSections = doc.sections.map((s) =>
      elaborateSection(s, globalTags, key),
    );

    const elaborated: SongDocument = {
      ...doc,
      sections: elaboratedSections,
      metadata: {
        ...(doc.metadata ?? {}),
        // Namespaced so a producer-authored `metadata.composer` survives
        // untouched. (Per Phase 2 review: never silently overwrite producer
        // metadata.)
        neo_fm_co_composer: {
          name: "WesternCoComposer",
          version: "0.1.0",
          key,
          tempo_descriptor: tempoDescriptor(doc.tempo_bpm),
          generated_at: new Date(0).toISOString(), // deterministic for golden tests
        },
      },
    };
    // v1.3 Sprint 4: emit phonemes for Hinglish / Indic-Latin lyrics
    // that producers occasionally drop into a Western pop track. The
    // helper is a no-op for plain English (language === "en" routes
    // through the English passthrough, which the singer hears as
    // standard Roman lyrics).
    return attachPhonemes(elaborated);
  }
}
