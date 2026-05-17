/**
 * Maps a PD lyric body into typed `Section` objects appropriate for a given
 * `style_family`.
 *
 * Rules (Phase 3, intentionally simple):
 * - Blank-line-separated stanzas become section bodies.
 * - Section types follow a style-specific template:
 *     western        -> intro, [verse, chorus]*, outro
 *     carnatic       -> pallavi, [anupallavi, charanam]*
 *     hindustani     -> [mukhda, antara]+
 *     kannada-folk   -> [folk_refrain, folk_stanza]*
 * - The `intro`/`outro` slots in `western` are leaderless (no lyrics); they
 *   give the renderer a runway in/out. Indian classical and folk forms keep
 *   every section text-bearing per the convention from the contracts.
 * - `target_seconds` is left unset here. The caller pipes the result through
 *   `allocateSectionDurations()` from `@neo-fm/song-doc`, which fills the
 *   remainder and refuses to produce a zero-second section.
 */

import type { Script, Section, SectionType, StyleFamily } from "@neo-fm/song-doc";

type SectionDraft = Omit<Section, "target_seconds"> & { target_seconds?: number };

function splitStanzas(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const TEMPLATES: Record<StyleFamily, SectionType[]> = {
  western: ["intro", "verse", "chorus", "verse", "chorus", "outro"],
  carnatic: ["pallavi", "anupallavi", "charanam"],
  hindustani: ["mukhda", "antara"],
  "kannada-folk": ["folk_refrain", "folk_stanza", "folk_refrain", "folk_stanza"],
  // v1.3 Sprint 2:
  // - Bhavageete is poem-set-to-frame; pallavi / charanam is the natural
  //   light-classical shape (mirrors what the co-composer expects).
  // - Tamil folk uses the same folk-refrain/stanza alternation as the
  //   Kannada folk template; it's a regional / language split, not a
  //   structural one.
  "kannada-light-classical": ["pallavi", "charanam", "pallavi"],
  "tamil-folk": [
    "folk_refrain",
    "folk_stanza",
    "folk_refrain",
    "folk_stanza",
  ],
  // v1.4 Sprint 2: new style families.
  // - Bollywood ballad: Western verse-chorus-verse-chorus skeleton with
  //   an intro/outro runway — the typical 4-section radio-pop shape.
  // - Bengali rabindrasangeet: Tagore's songs follow a mukhda/antara
  //   contour identical to Hindustani lyric form. Re-use that template.
  // - Telugu keerthana: Tyagaraja-style keerthana mirrors the Carnatic
  //   kriti structure (pallavi/anupallavi/charanam).
  // - Sanskrit shloka: chant form lands on the dedicated shloka section
  //   types (verse / refrain / phalashruti). Sprint 14 refines this.
  "bollywood-ballad": ["intro", "verse", "chorus", "verse", "chorus", "outro"],
  "bengali-rabindrasangeet": ["mukhda", "antara"],
  "telugu-keerthana": ["pallavi", "anupallavi", "charanam"],
  "sanskrit-shloka": [
    "shloka_verse",
    "shloka_refrain",
    "shloka_verse",
    "phalashruti",
  ],
};

/** Section types whose body MUST be empty (no lyrics). */
const LEADERLESS: ReadonlySet<SectionType> = new Set<SectionType>([
  "intro",
  "outro",
]);

function safeId(base: string, idx: number): string {
  return `${base}-${idx + 1}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export interface MapToSectionsParams {
  body: string;
  style_family: StyleFamily;
  script: Script;
}

export function mapToSections(params: MapToSectionsParams): SectionDraft[] {
  const stanzas = splitStanzas(params.body);
  if (stanzas.length === 0) {
    throw new Error("mapToSections: body is empty after stanza split");
  }

  const template = TEMPLATES[params.style_family];

  // Pick a sequence of section types that:
  //  1. starts at the template head
  //  2. is long enough to consume every stanza we have
  //  3. avoids assigning lyrics to a LEADERLESS slot
  const types: SectionType[] = [];
  let stanzaCursor = 0;
  let templateCursor = 0;
  // Cycle through the template until all stanzas are placed.
  while (stanzaCursor < stanzas.length) {
    const candidate = template[templateCursor % template.length]!;
    if (LEADERLESS.has(candidate)) {
      // Reserve runway slots — they take no stanza.
      types.push(candidate);
    } else {
      types.push(candidate);
      stanzaCursor += 1;
    }
    templateCursor += 1;
    // Safety: bail if cycle count gets pathological (shouldn't happen with
    // sane templates, but a malformed template extension shouldn't hang).
    if (templateCursor > stanzas.length * template.length + template.length) {
      throw new Error(
        `mapToSections: could not place ${stanzas.length} stanzas using ` +
          `template for style_family=${params.style_family}`,
      );
    }
  }
  // Close with an "outro" for Western if not already present.
  if (
    params.style_family === "western" &&
    types[types.length - 1] !== "outro"
  ) {
    types.push("outro");
  }

  const sections: SectionDraft[] = [];
  let stanzaIdx = 0;
  for (let i = 0; i < types.length; i += 1) {
    const type = types[i]!;
    if (LEADERLESS.has(type)) {
      sections.push({
        id: safeId(type, i),
        type,
        // No lyrics, no script (it's instrumental runway).
      });
    } else {
      const stanza = stanzas[stanzaIdx];
      if (stanza === undefined) {
        // Template wanted more lyric sections than we have stanzas. Skip.
        continue;
      }
      sections.push({
        id: safeId(type, i),
        type,
        lyrics: stanza,
        script: params.script,
      });
      stanzaIdx += 1;
    }
  }
  return sections;
}
