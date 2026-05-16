/**
 * Tamil-folk co-composer.
 *
 * Tamil-folk janapada is dance-oriented, percussion-forward, and
 * culturally distinct from Karnataka janapada — different rhythmic
 * drive (parai pulse), different orchestration (parai + nadaswaram +
 * thavil), different default meter (4/4 dance, not 6/8 lyric). The
 * v1.2 catalog parked Tamil-folk under `kannada-folk` because the
 * schema had no Tamil bucket and no Tamil language code; v1.3
 * Sprint 2 fixes both ends:
 *
 *   - migration 0032 adds `tamil-folk` to style_family_enum.
 *   - migration 0033 adds `ta` to language_enum so the preset can
 *     route Tamil lyrics through the same hot path as the other
 *     Indic languages.
 *
 * This composer mirrors the KannadaFolkCoComposer shape (no raga,
 * tag-merge respecting producers), with parai-percussion defaults.
 */

import type {
  Orchestration,
  Section,
  SongDocument,
} from "@neo-fm/song-doc";

import type { CoComposer } from "./index.js";
import { mergeTags } from "./tag-merge.js";

const DEFAULT_TIME_SIG = "4/4";
const DEFAULT_TEMPO_BPM = 124;

const SECTION_FUNCTION: Record<string, string> = {
  folk_refrain: "refrain",
  folk_stanza: "stanza",
  // Pass-through mappings:
  intro: "introduction",
  verse: "stanza",
  chorus: "refrain",
  bridge: "interlude",
  outro: "resolution",
  pallavi: "refrain",
  anupallavi: "refrain-development",
  charanam: "stanza",
  mukhda: "refrain",
  antara: "stanza",
  alaap: "introduction",
  sargam: "stanza",
  saranam: "stanza",
};

const DEFAULT_ORCHESTRATION: Orchestration = {
  lead_vocal: "male",
  instruments: ["parai", "thavil", "nadaswaram", "flute"],
  texture: "percussion+lead",
};

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

function tempoDescriptor(bpm: number): string {
  if (bpm < 80) return "tempo:slow-ballad";
  if (bpm < 115) return "tempo:mid-tempo";
  if (bpm < 145) return "tempo:upbeat";
  return "tempo:dance";
}

function elaborateSection(
  section: Section,
  globalTags: readonly string[],
): Section {
  const fn = SECTION_FUNCTION[section.type] ?? "stanza";
  const composerTags: string[] = [
    `section:${section.type}`,
    `function:${fn}`,
    ...globalTags,
  ];
  return { ...section, tags: mergeTags(section.tags, composerTags) };
}

export class TamilFolkCoComposer implements CoComposer {
  readonly style_family = "tamil-folk" as const;

  async elaborate(doc: SongDocument): Promise<SongDocument> {
    if (doc.style_family !== "tamil-folk") {
      throw new Error(
        `TamilFolkCoComposer received style_family=${doc.style_family}; use getCoComposer(doc.style_family) instead`,
      );
    }
    if (
      doc.tempo_bpm !== undefined &&
      (doc.tempo_bpm < 30 || doc.tempo_bpm > 240)
    ) {
      throw new Error(
        `TamilFolkCoComposer rejects tempo_bpm=${doc.tempo_bpm}; valid range is 30-240`,
      );
    }

    const tempo = doc.tempo_bpm ?? DEFAULT_TEMPO_BPM;
    const timeSig = doc.time_signature ?? DEFAULT_TIME_SIG;
    const orchestration = doc.orchestration ?? DEFAULT_ORCHESTRATION;

    const globalTags: string[] = [
      `style:${doc.style_family}`,
      `genre:janapada`,
      `region:tamil`,
      `time_sig:${timeSig}`,
      tempoDescriptor(tempo),
      ...instrumentTags(orchestration),
    ];

    const elaboratedSections = doc.sections.map((s) =>
      elaborateSection(s, globalTags),
    );

    return {
      ...doc,
      tempo_bpm: doc.tempo_bpm ?? tempo,
      time_signature: doc.time_signature ?? timeSig,
      orchestration: doc.orchestration ?? orchestration,
      sections: elaboratedSections,
      metadata: {
        ...(doc.metadata ?? {}),
        neo_fm_co_composer: {
          name: "TamilFolkCoComposer",
          version: "0.1.0",
          region: "tamil",
          tempo_descriptor: tempoDescriptor(tempo),
          generated_at: new Date(0).toISOString(),
        },
      },
    };
  }
}
