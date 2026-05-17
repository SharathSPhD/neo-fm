/**
 * Hindustani co-composer.
 *
 * Mirrors `CarnaticCoComposer` (see that file for the design rationale).
 * Hindustani differs in:
 *
 *   - **Default raga**: Yaman (Kalyan thaat -- M2 tivra). Yaman is the
 *     khyal opener and HeartMuLa has good coverage of it.
 *   - **Time descriptor**: vilambit (slow) / madhya (medium) / drut (fast).
 *   - **Default tala**: Teentaal (16 beats, 4+4+4+4). Ektaal, Jhaptal,
 *     Dadra and Rupak are also recognised.
 *   - **Section types**: mukhda (theme) / antara (development) / alaap
 *     (free, unmetered).
 *   - **Default orchestration**: female lead + harmonium + tabla + tanpura.
 *
 * The mapping is intentionally pragmatic: HeartMuLa was trained on Latin
 * prompts and recognises raga/tala names by their common Romanisation.
 * We forward both the scale (aroha/avaroha) and the name so the model has
 * two signals to lock onto.
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

interface RagaEntry {
  name: string;
  aroha: string;
  avaroha: string;
  pakad?: string;
}

// Five raga starter set covering common moods (peaceful, devotional,
// dawn, late-night, melodic).
const HINDUSTANI_RAGAS: Record<string, RagaEntry> = {
  yaman: {
    name: "yaman",
    aroha: "N3 R2 G3 M2 P D2 N3 S'",
    avaroha: "S' N3 D2 P M2 G3 R2 S",
    pakad: "N3 R2 G3 M2 D2 N3 S'",
  },
  bhairavi: {
    name: "bhairavi",
    aroha: "S R1 G2 M1 P D1 N2 S'",
    avaroha: "S' N2 D1 P M1 G2 R1 S",
    pakad: "G2 M1 D1 N2 D1 P",
  },
  bhairav: {
    name: "bhairav",
    aroha: "S R1 G3 M1 P D1 N3 S'",
    avaroha: "S' N3 D1 P M1 G3 R1 S",
    pakad: "G3 M1 D1 P G3 M1 R1 S",
  },
  bageshri: {
    name: "bageshri",
    aroha: "S G2 M1 D2 N3 S'",
    avaroha: "S' N3 D2 M1 G2 R2 S",
    pakad: "M1 D2 N3 D2 M1 G2 R2 S",
  },
  desh: {
    name: "desh",
    aroha: "S R2 M1 P N3 S'",
    avaroha: "S' N2 D2 P M1 G3 R2 S",
    pakad: "R2 M1 P N3 S' R2' N3 D2 P",
  },
};

const DEFAULT_RAGA = "yaman";

type TalaName = "teentaal" | "ektaal" | "jhaptal" | "dadra" | "rupak";

const TALA_BEATS: Record<TalaName, number> = {
  teentaal: 16,
  ektaal: 12,
  jhaptal: 10,
  dadra: 6,
  rupak: 7,
};

const DEFAULT_TALA: TalaName = "teentaal";

const SECTION_FUNCTION: Record<string, string> = {
  mukhda: "theme-statement",
  antara: "development",
  alaap: "free-improvisation",
  sargam: "solfege-improvisation",
  pallavi: "theme-statement",
  anupallavi: "development",
  charanam: "verse",
  intro: "free-improvisation",
  verse: "theme-statement",
  chorus: "theme-statement",
  bridge: "development",
  outro: "resolution",
  saranam: "verse",
  folk_refrain: "theme-statement",
  folk_stanza: "verse",
};

const DEFAULT_ORCHESTRATION: Orchestration = {
  lead_vocal: "female",
  instruments: ["harmonium", "tabla", "tanpura"],
  texture: "drone+lead+percussion",
};

function lookupRaga(doc: SongDocument): RagaEntry {
  const supplied = doc.raga?.name?.toLowerCase();
  if (supplied) {
    const known = HINDUSTANI_RAGAS[supplied];
    if (known) return known;
    return {
      name: supplied,
      aroha: (doc.raga?.arohana ?? []).join(" ") || "S R2 G3 M1 P D2 N3 S'",
      avaroha:
        (doc.raga?.avarohana ?? []).join(" ") || "S' N3 D2 P M1 G3 R2 S",
      pakad: doc.raga?.pakad,
    };
  }
  const def = HINDUSTANI_RAGAS[DEFAULT_RAGA];
  if (!def) {
    throw new Error(`internal: default Hindustani raga ${DEFAULT_RAGA} missing`);
  }
  return def;
}

function lookupTala(doc: SongDocument): TalaName {
  const supplied = (doc.tala ?? "").toLowerCase().replace(/\s+/g, "");
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
  if (bpm === undefined) return "tempo:madhya";
  if (bpm < 75) return "tempo:vilambit";
  if (bpm < 130) return "tempo:madhya";
  return "tempo:drut";
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

export class HindustaniCoComposer implements CoComposer {
  readonly style_family = "hindustani" as const;
  // v1.4: also accepts bengali-rabindrasangeet (Tagore songs catalogued
  // under Hindustani ragas). Composer sets `raga.system: "hindustani"`
  // which the song-doc schema's STYLE_RAGA_ALLOWLIST permits for both.
  readonly acceptedStyleFamilies: ReadonlySet<StyleFamily> = new Set([
    "hindustani",
    "bengali-rabindrasangeet",
  ]);

  async elaborate(doc: SongDocument): Promise<SongDocument> {
    if (!this.acceptedStyleFamilies.has(doc.style_family)) {
      throw new Error(
        `HindustaniCoComposer received style_family=${doc.style_family}; use getCoComposer(doc.style_family) instead`,
      );
    }
    if (
      doc.tempo_bpm !== undefined &&
      (doc.tempo_bpm < 30 || doc.tempo_bpm > 240)
    ) {
      throw new Error(
        `HindustaniCoComposer rejects tempo_bpm=${doc.tempo_bpm}; valid range is 30-240`,
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

    const elaborated: SongDocument = {
      ...doc,
      raga: doc.raga ?? {
        name: raga.name,
        system: "hindustani",
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
          name: "HindustaniCoComposer",
          version: "0.1.0",
          raga: raga.name,
          tala,
          tempo_descriptor: tempoDescriptor(doc.tempo_bpm),
          generated_at: new Date(0).toISOString(),
        },
      },
    };
    return attachPhonemes(elaborated);
  }
}
