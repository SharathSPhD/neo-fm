/**
 * Kannada light-classical co-composer (sugama sangeetha).
 *
 * Bhavageete is the Kannada light-classical lyric song: a poem (the
 * "bhava") set to a melodic frame that sits between formal Hindustani
 * / Carnatic kriti work and outright Janapada folk. It is NOT folk;
 * v1.2 collapsed it into `kannada-folk` and that is exactly what this
 * module fixes (v1.3 Sprint 2).
 *
 * Distinctives vs Janapada (handled by KannadaFolkCoComposer):
 *
 *   - Lead instrument is the harmonium, not dhol.
 *   - Default tempo is slower (mid-tempo ballad) — 88 bpm here vs
 *     110 bpm for folk.
 *   - Default meter is 6/8 (sahityaa-friendly compound duple) but the
 *     composer respects any producer-set time signature.
 *   - Section vocabulary is poem-first: pallavi / charanam / refrain;
 *     producers using folk_refrain / folk_stanza still work via the
 *     pass-through map below.
 *   - Genre tag is pinned `genre:bhavageete` so HeartMuLa picks the
 *     light-classical register instead of the folk register.
 *
 * Like the folk composer, bhavageete is not raga-bound (the song
 * cycles through familiar Hindustani/Carnatic frames but the form
 * itself doesn't demand a raga lock). Zod's superRefine on the
 * SongDocument rejects a raga + non-classical style anyway; we
 * leave `doc.raga` alone if a producer set it for a classical
 * variant — that's still a Zod-level error, not our problem to fix.
 */

import type {
  Orchestration,
  Section,
  SongDocument,
} from "@neo-fm/song-doc";

import type { CoComposer } from "./index.js";
import { mergeTags } from "./tag-merge.js";

const DEFAULT_TIME_SIG = "6/8";
const DEFAULT_TEMPO_BPM = 88;

const SECTION_FUNCTION: Record<string, string> = {
  // Bhavageete-native:
  pallavi: "refrain",
  charanam: "stanza",
  folk_refrain: "refrain",
  folk_stanza: "stanza",
  // Pass-through for producers using Carnatic / Hindustani types:
  anupallavi: "refrain-development",
  mukhda: "refrain",
  antara: "stanza",
  alaap: "introduction",
  sargam: "stanza",
  saranam: "stanza",
  // Pass-through for producers using Western types:
  intro: "introduction",
  verse: "stanza",
  chorus: "refrain",
  bridge: "interlude",
  outro: "resolution",
};

const DEFAULT_ORCHESTRATION: Orchestration = {
  lead_vocal: "female",
  instruments: ["harmonium", "tabla", "tanpura", "flute"],
  texture: "lead+rhythm+drone",
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
  if (bpm < 75) return "tempo:slow-ballad";
  if (bpm < 100) return "tempo:mid-tempo";
  if (bpm < 130) return "tempo:upbeat";
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

export class KannadaLightClassicalCoComposer implements CoComposer {
  readonly style_family = "kannada-light-classical" as const;

  async elaborate(doc: SongDocument): Promise<SongDocument> {
    if (doc.style_family !== "kannada-light-classical") {
      throw new Error(
        `KannadaLightClassicalCoComposer received style_family=${doc.style_family}; use getCoComposer(doc.style_family) instead`,
      );
    }
    if (
      doc.tempo_bpm !== undefined &&
      (doc.tempo_bpm < 30 || doc.tempo_bpm > 240)
    ) {
      throw new Error(
        `KannadaLightClassicalCoComposer rejects tempo_bpm=${doc.tempo_bpm}; valid range is 30-240`,
      );
    }

    const tempo = doc.tempo_bpm ?? DEFAULT_TEMPO_BPM;
    const timeSig = doc.time_signature ?? DEFAULT_TIME_SIG;
    const orchestration = doc.orchestration ?? DEFAULT_ORCHESTRATION;

    const globalTags: string[] = [
      `style:${doc.style_family}`,
      // Pinned: this composer's identity. Producers can override via
      // their own `genre:` tag and mergeTags will respect that.
      `genre:bhavageete`,
      `register:light-classical`,
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
          name: "KannadaLightClassicalCoComposer",
          version: "0.1.0",
          register: "light-classical",
          tempo_descriptor: tempoDescriptor(tempo),
          generated_at: new Date(0).toISOString(),
        },
      },
    };
  }
}
