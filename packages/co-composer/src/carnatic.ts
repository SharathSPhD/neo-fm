/**
 * Carnatic co-composer.
 *
 * Given a SongDocument with `style_family: "carnatic"`, fill in per-section
 * synthesis hints HeartMuLa consumes through the `tags` channel:
 *
 *   1. Raga -- pick a sensible default (Mohanam, pentatonic and AI-friendly)
 *      when none is supplied; otherwise honour the producer's raga.
 *      Aroha / avaroha / pakad are forwarded as tags so HeartMuLa conditions
 *      on the scale geometry, not just the raga name.
 *   2. Tala -- default Adi (8 beats); allow Rupakam, Misra Chapu, Khanda
 *      Chapu, Ata. Forwarded as `tala:<name>`.
 *   3. Section function -- pallavi (theme statement) / anupallavi
 *      (development) / charanam (verse) / alaap (free, unmetered) /
 *      sargam (solfege-style) map to a `function:<purpose>` tag so the
 *      model picks tempo and density appropriately. Western section types
 *      (verse, chorus, bridge, outro) are also accepted -- they get mapped
 *      to the closest Carnatic function (verse → pallavi, chorus → anupallavi).
 *   4. Instrumentation -- defaults to (female lead, mridangam + tanpura +
 *      violin); user choices are preserved verbatim.
 *
 * The composer is deterministic and never overwrites producer-supplied
 * tags (see tag-merge.ts). It refuses style_family mismatches.
 *
 * TRIZ C8: only forward what the producer or the catalogue knows.
 * Unknown raga names pass through as `raga:<name>` without scale data --
 * HeartMuLa can still recognise the raga from prompts in its training set.
 */

import type {
  Orchestration,
  Section,
  SongDocument,
} from "@neo-fm/song-doc";

import type { CoComposer } from "./index.js";
import { mergeTags } from "./tag-merge.js";

interface RagaEntry {
  name: string;
  aroha: string;
  avaroha: string;
  pakad?: string;
}

// Five widely-recognised Carnatic ragas. Notation: S R2 G3 M1 P D2 N3 (the
// numbers are the Karnatak svarasthana indices, where R1 is komal-ish komal,
// R2 is shuddha rishabha, etc.). Apostrophe denotes the higher octave.
const CARNATIC_RAGAS: Record<string, RagaEntry> = {
  kalyani: {
    name: "kalyani",
    aroha: "S R2 G3 M2 P D2 N3 S'",
    avaroha: "S' N3 D2 P M2 G3 R2 S",
    pakad: "G3 R2 G3 M2 P D2 N3 S'",
  },
  bhairavi: {
    name: "bhairavi",
    aroha: "S R2 G2 M1 P D2 N2 S'",
    avaroha: "S' N2 D1 P M1 G2 R2 S",
    pakad: "P D2 N2 S' N2 D1 P",
  },
  mohanam: {
    name: "mohanam",
    aroha: "S R2 G3 P D2 S'",
    avaroha: "S' D2 P G3 R2 S",
    pakad: "P G3 R2 S D2 S",
  },
  hamsadhwani: {
    name: "hamsadhwani",
    aroha: "S R2 G3 P N3 S'",
    avaroha: "S' N3 P G3 R2 S",
    pakad: "G3 P N3 S' N3 P G3 R2 S",
  },
  shankarabharanam: {
    name: "shankarabharanam",
    aroha: "S R2 G3 M1 P D2 N3 S'",
    avaroha: "S' N3 D2 P M1 G3 R2 S",
    pakad: "G3 M1 P D2 N3 S'",
  },
};

const DEFAULT_RAGA = "mohanam";

// Adi is the most commonly heard Carnatic tala (8 beats, 4+2+2). We use the
// English name in the tag because HeartMuLa's training set uses Latin
// transliteration; numeric beat counts go alongside so the model can also
// match on a numeric prior if it has one.
type TalaName =
  | "adi"
  | "rupakam"
  | "misra-chapu"
  | "khanda-chapu"
  | "ata";

const TALA_BEATS: Record<TalaName, number> = {
  adi: 8,
  rupakam: 6,
  "misra-chapu": 7,
  "khanda-chapu": 5,
  ata: 14,
};

const DEFAULT_TALA: TalaName = "adi";

// Carnatic section types in the Song Document DSL plus pass-through mapping
// for western names that producers might still send.
const SECTION_FUNCTION: Record<string, string> = {
  pallavi: "theme-statement",
  anupallavi: "development",
  charanam: "verse",
  alaap: "free-improvisation",
  sargam: "solfege-improvisation",
  // Western names that producers / Phase 3 lyrics flow sometimes use.
  // These are still legal in the Zod enum (the schema spans every
  // style_family); we forward them to the closest Carnatic function so
  // HeartMuLa picks the right density.
  intro: "free-improvisation",
  verse: "theme-statement",
  chorus: "theme-statement",
  bridge: "development",
  outro: "resolution",
  saranam: "verse",
  mukhda: "theme-statement",
  antara: "development",
  folk_refrain: "theme-statement",
  folk_stanza: "verse",
};

const DEFAULT_ORCHESTRATION: Orchestration = {
  lead_vocal: "female",
  instruments: ["mridangam", "tanpura", "violin"],
  texture: "drone+lead+percussion",
};

function lookupRaga(doc: SongDocument): RagaEntry {
  const supplied = doc.raga?.name?.toLowerCase();
  if (supplied) {
    const known = CARNATIC_RAGAS[supplied];
    if (known) return known;
    // Unknown raga: forward the name as-is, no scale data. HeartMuLa
    // may still know the raga; if not, the producer should have
    // supplied arohana/avarohana on the Song Document.
    return {
      name: supplied,
      aroha: (doc.raga?.arohana ?? []).join(" ") || "S R2 G3 M1 P D2 N3 S'",
      avaroha:
        (doc.raga?.avarohana ?? []).join(" ") || "S' N3 D2 P M1 G3 R2 S",
      pakad: doc.raga?.pakad,
    };
  }
  const def = CARNATIC_RAGAS[DEFAULT_RAGA];
  if (!def) {
    // unreachable: DEFAULT_RAGA is a literal in the catalogue. Defence
    // in depth so the type narrows correctly.
    throw new Error(`internal: default Carnatic raga ${DEFAULT_RAGA} missing`);
  }
  return def;
}

function lookupTala(doc: SongDocument): TalaName {
  const supplied = (doc.tala ?? "").toLowerCase().replace(/\s+/g, "-");
  if (supplied && supplied in TALA_BEATS) {
    return supplied as TalaName;
  }
  return DEFAULT_TALA;
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

function tempoDescriptor(bpm: number | undefined): string {
  // Carnatic concerts label tempo "kala" -- vilamba (slow), madhyama
  // (medium), durita (fast). We map to those so HeartMuLa picks up the
  // genre-appropriate prior, falling back to the western-tempo bucket if
  // the producer didn't supply one.
  if (bpm === undefined) return "tempo:madhyama";
  if (bpm < 65) return "tempo:vilamba";
  if (bpm < 110) return "tempo:madhyama";
  return "tempo:durita";
}

function elaborateSection(
  section: Section,
  globalTags: readonly string[],
): Section {
  const fn = SECTION_FUNCTION[section.type] ?? "verse";
  const composerTags: string[] = [
    `section:${section.type}`,
    `function:${fn}`,
    ...globalTags,
  ];
  return { ...section, tags: mergeTags(section.tags, composerTags) };
}

export class CarnaticCoComposer implements CoComposer {
  readonly style_family = "carnatic" as const;

  async elaborate(doc: SongDocument): Promise<SongDocument> {
    if (doc.style_family !== "carnatic") {
      throw new Error(
        `CarnaticCoComposer received style_family=${doc.style_family}; use getCoComposer(doc.style_family) instead`,
      );
    }
    if (
      doc.tempo_bpm !== undefined &&
      (doc.tempo_bpm < 30 || doc.tempo_bpm > 240)
    ) {
      throw new Error(
        `CarnaticCoComposer rejects tempo_bpm=${doc.tempo_bpm}; valid range is 30-240`,
      );
    }

    const raga = lookupRaga(doc);
    const tala = lookupTala(doc);
    const orchestration = doc.orchestration ?? DEFAULT_ORCHESTRATION;
    const beats = TALA_BEATS[tala];

    const globalTags: string[] = [
      `style:${doc.style_family}`,
      `raga:${raga.name}`,
      `aroha:${raga.aroha}`,
      `avaroha:${raga.avaroha}`,
      ...(raga.pakad ? [`pakad:${raga.pakad}`] : []),
      `tala:${tala}`,
      `tala_beats:${beats}`,
      tempoDescriptor(doc.tempo_bpm),
      ...(doc.time_signature ? [`time_sig:${doc.time_signature}`] : []),
      ...instrumentTags(orchestration),
    ];

    const elaboratedSections = doc.sections.map((s) =>
      elaborateSection(s, globalTags),
    );

    // Promote the inferred raga / tala / orchestration onto the SongDocument
    // itself so downstream consumers (the worker's `build_inference_request`,
    // the song detail page, the tracks table) see what the composer chose,
    // not just what the producer typed. The Zod schema enforces
    // raga.system === "carnatic" for carnatic style; we set it explicitly.
    return {
      ...doc,
      raga: doc.raga ?? {
        name: raga.name,
        system: "carnatic",
        arohana: raga.aroha.split(/\s+/).filter(Boolean),
        avarohana: raga.avaroha.split(/\s+/).filter(Boolean),
        ...(raga.pakad ? { pakad: raga.pakad } : {}),
      },
      tala: doc.tala ?? tala,
      orchestration: doc.orchestration ?? orchestration,
      sections: elaboratedSections,
      metadata: {
        ...(doc.metadata ?? {}),
        neo_fm_co_composer: {
          name: "CarnaticCoComposer",
          version: "0.1.0",
          raga: raga.name,
          tala,
          tempo_descriptor: tempoDescriptor(doc.tempo_bpm),
          generated_at: new Date(0).toISOString(),
        },
      },
    };
  }
}
