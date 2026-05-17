/**
 * Kannada-folk (Janapada) co-composer.
 *
 * v1.3 Sprint 2 split this composer's concerns:
 *
 *   - Bhavageete (Kannada light-classical lyric song) used to default
 *     through this composer too. It now lives in
 *     `KannadaLightClassicalCoComposer` under the new
 *     `kannada-light-classical` style family. This composer is now
 *     pure Janapada (Kannada folk).
 *
 * Defaults:
 *
 *   - **Genre**: janapada (folk). Producers can still override via
 *     `metadata.genre` or section tags; the upstream router shouldn't
 *     send us bhavageete any more (it has its own style family).
 *   - **Time signature**: 6/8 (compound duple, the workhorse of
 *     Karnataka folk). Janapada often uses 4/4 or 3/4 too; producer
 *     override wins.
 *   - **Tempo**: 110 bpm (mid-tempo folk).
 *   - **Orchestration**: female lead + dhol + flute + tabla + percussion.
 *   - **Section types**: folk_refrain / folk_stanza (the DSL's folk-native
 *     types), with western/Carnatic types passed through with closest
 *     function mapping.
 *
 * No raga because folk songs aren't strictly raga-bound. The DSL will
 * reject a non-empty `raga` with `style_family=kannada-folk` regardless
 * (Zod superRefine), but defence in depth: this composer also strips any
 * stray `raga:` / `aroha:` tags a producer might have added.
 */

import type {
  Orchestration,
  Section,
  SongDocument,
} from "@neo-fm/song-doc";

import type { CoComposer } from "./index.js";
import { attachPhonemes } from "./phonemes.js";
import { mergeTags } from "./tag-merge.js";

// We keep "bhavageete" as a recognised override value purely for
// backward-compatibility: any v1.2 docs already on disk that pinned
// metadata.genre = "bhavageete" will still elaborate cleanly. New
// bhavageete content should use style_family="kannada-light-classical"
// instead — the upstream router routes there.
type Genre = "janapada" | "bhavageete";

const DEFAULT_GENRE: Genre = "janapada";
const DEFAULT_TIME_SIG = "6/8";
const DEFAULT_TEMPO_BPM = 110;

const SECTION_FUNCTION: Record<string, string> = {
  folk_refrain: "refrain",
  folk_stanza: "stanza",
  // pass-through mappings for producers using western/Carnatic types:
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
  lead_vocal: "female",
  instruments: ["dhol", "flute", "tabla", "percussion"],
  texture: "lead+rhythm",
};

function inferGenre(doc: SongDocument): Genre {
  const md = doc.metadata as Record<string, unknown> | undefined;
  const g = md?.genre;
  if (g === "janapada" || g === "bhavageete") return g;
  // Producers can also tag a section "genre:janapada". Look at the first
  // section that supplies one; absent that, fall back to the default.
  for (const section of doc.sections) {
    for (const t of section.tags ?? []) {
      if (t === "genre:janapada") return "janapada";
      if (t === "genre:bhavageete") return "bhavageete";
    }
  }
  return DEFAULT_GENRE;
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

function tempoDescriptor(bpm: number): string {
  if (bpm < 80) return "tempo:ballad";
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

export class KannadaFolkCoComposer implements CoComposer {
  readonly style_family = "kannada-folk" as const;

  async elaborate(doc: SongDocument): Promise<SongDocument> {
    if (doc.style_family !== "kannada-folk") {
      throw new Error(
        `KannadaFolkCoComposer received style_family=${doc.style_family}; use getCoComposer(doc.style_family) instead`,
      );
    }
    if (
      doc.tempo_bpm !== undefined &&
      (doc.tempo_bpm < 30 || doc.tempo_bpm > 240)
    ) {
      throw new Error(
        `KannadaFolkCoComposer rejects tempo_bpm=${doc.tempo_bpm}; valid range is 30-240`,
      );
    }

    const genre = inferGenre(doc);
    const tempo = doc.tempo_bpm ?? DEFAULT_TEMPO_BPM;
    const timeSig = doc.time_signature ?? DEFAULT_TIME_SIG;
    const orchestration = doc.orchestration ?? DEFAULT_ORCHESTRATION;

    const globalTags: string[] = [
      `style:${doc.style_family}`,
      `genre:${genre}`,
      `time_sig:${timeSig}`,
      tempoDescriptor(tempo),
      ...instrumentTags(orchestration),
    ];

    const elaboratedSections = doc.sections.map((s) =>
      elaborateSection(s, globalTags),
    );

    const elaborated: SongDocument = {
      ...doc,
      // Promote inferred values onto the Song Document. Note: folk style
      // doesn't carry a raga -- the Zod schema enforces this -- so we
      // leave `raga` undefined.
      tempo_bpm: doc.tempo_bpm ?? tempo,
      time_signature: doc.time_signature ?? timeSig,
      orchestration: doc.orchestration ?? orchestration,
      sections: elaboratedSections,
      metadata: {
        ...(doc.metadata ?? {}),
        neo_fm_co_composer: {
          name: "KannadaFolkCoComposer",
          version: "0.1.0",
          genre,
          tempo_descriptor: tempoDescriptor(tempo),
          generated_at: new Date(0).toISOString(),
        },
      },
    };
    return attachPhonemes(elaborated);
  }
}
