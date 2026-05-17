/**
 * v1.4 live-bug closeout: dispatcher contract test.
 *
 * The bug we're closing here: `getCoComposer` used to route four
 * widened style families (sanskrit-shloka, telugu-keerthana,
 * bengali-rabindrasangeet, bollywood-ballad) to fallback composers
 * (Carnatic / Hindustani / Western) whose `elaborate()` threw on any
 * `doc.style_family !== "carnatic"` (or western / hindustani). Every
 * queue POST for those four families returned 400 from
 * /api/songs with `error: "co_composer_rejected"`.
 *
 * This test iterates EVERY `StyleFamily` literal, builds a minimal
 * valid `SongDocument`, runs it through `getCoComposer(s).elaborate`,
 * and asserts:
 *
 *   1. elaborate() does not throw,
 *   2. the returned document re-parses against `SongDocumentSchema`,
 *   3. tags include `style:<doc.style_family>` -- the user-facing
 *      family flows through, not the delegated composer's.
 *
 * If a new style family is added to `StyleFamilySchema` and isn't
 * wired into the dispatcher or any composer's `acceptedStyleFamilies`,
 * this test fails loudly here rather than at runtime in production.
 */
import { describe, expect, it } from "vitest";

import {
  type Language,
  type SongDocument,
  SongDocumentSchema,
  StyleFamilySchema,
  type StyleFamily,
} from "@neo-fm/song-doc";

import { getCoComposer } from "./index.js";

/**
 * Minimal valid SongDocument shell per family.
 *
 * Each entry only sets fields that diverge from the western/default
 * shell so the per-family stanza stays small. The full doc is built
 * by merging with `BASE_DOC` and adding three 30-second sections that
 * sum to the schema's `target_duration_seconds`.
 */
const PER_FAMILY: Record<
  StyleFamily,
  {
    language: Language;
    sections: Array<{ id: string; type: string; lyrics: string }>;
    /** Optional raga to satisfy STYLE_RAGA_ALLOWLIST. */
    raga?: SongDocument["raga"];
  }
> = {
  western: {
    language: "en",
    sections: [
      { id: "v1", type: "verse", lyrics: "I will" },
      { id: "c1", type: "chorus", lyrics: "go now" },
      { id: "v2", type: "verse", lyrics: "with you" },
    ],
  },
  "bollywood-ballad": {
    language: "hi",
    sections: [
      { id: "v1", type: "verse", lyrics: "तुम" },
      { id: "c1", type: "chorus", lyrics: "मेरे" },
      { id: "v2", type: "verse", lyrics: "साथ" },
    ],
  },
  carnatic: {
    language: "hi",
    sections: [
      { id: "p", type: "pallavi", lyrics: "क" },
      { id: "a", type: "anupallavi", lyrics: "ख" },
      { id: "c", type: "charanam", lyrics: "ग" },
    ],
  },
  hindustani: {
    language: "hi",
    sections: [
      { id: "muk", type: "mukhda", lyrics: "क" },
      { id: "an", type: "antara", lyrics: "ख" },
      { id: "an2", type: "antara", lyrics: "ग" },
    ],
  },
  "kannada-folk": {
    language: "kn",
    sections: [
      { id: "r1", type: "folk_refrain", lyrics: "ಕ" },
      { id: "s1", type: "folk_stanza", lyrics: "ಖ" },
      { id: "r2", type: "folk_refrain", lyrics: "ಗ" },
    ],
  },
  "kannada-light-classical": {
    language: "kn",
    sections: [
      { id: "v1", type: "verse", lyrics: "ಕ" },
      { id: "c1", type: "chorus", lyrics: "ಖ" },
      { id: "v2", type: "verse", lyrics: "ಗ" },
    ],
  },
  "tamil-folk": {
    language: "ta",
    sections: [
      { id: "r1", type: "folk_refrain", lyrics: "க" },
      { id: "s1", type: "folk_stanza", lyrics: "஖" },
      { id: "r2", type: "folk_refrain", lyrics: "ங" },
    ],
  },
  "sanskrit-shloka": {
    language: "sa",
    sections: [
      // Sprint 14 widened SectionSchema to accept these section types.
      { id: "v1", type: "shloka_verse", lyrics: "ॐ" },
      { id: "r1", type: "shloka_refrain", lyrics: "नमः" },
      { id: "p1", type: "phalashruti", lyrics: "शिवाय" },
    ],
  },
  "bengali-rabindrasangeet": {
    language: "bn",
    sections: [
      // Tagore's 4-part form (sthayi/antara/sanchari/abhog) isn't in
      // the SectionSchema enum yet; we use mukhda/antara (Hindustani
      // analogues the composer maps internally). When the dedicated
      // bengali composer lands these can be promoted.
      { id: "muk", type: "mukhda", lyrics: "ক" },
      { id: "an", type: "antara", lyrics: "খ" },
      { id: "an2", type: "antara", lyrics: "গ" },
    ],
    raga: {
      name: "bhairavi",
      system: "hindustani",
      arohana: ["S", "r", "g", "m", "P", "d", "n", "S'"],
      avarohana: ["S'", "n", "d", "P", "m", "g", "r", "S"],
    },
  },
  "telugu-keerthana": {
    language: "te",
    sections: [
      { id: "p", type: "pallavi", lyrics: "క" },
      { id: "a", type: "anupallavi", lyrics: "ఖ" },
      { id: "c", type: "charanam", lyrics: "గ" },
    ],
  },
};

function buildDoc(style: StyleFamily): SongDocument {
  const spec = PER_FAMILY[style];
  // Three 30-second sections so sum === target_duration_seconds (the
  // schema's superRefine requires the equality and there's no need
  // to call allocateSectionDurations from a test fixture).
  const sections = spec.sections.map((s) => ({ ...s, target_seconds: 30 }));
  const raw: Record<string, unknown> = {
    language: spec.language,
    style_family: style,
    tempo_bpm: 90,
    target_duration_seconds: 90,
    sections,
  };
  if (spec.raga) {
    raw.raga = spec.raga;
  }
  return SongDocumentSchema.parse(raw);
}

describe("getCoComposer dispatcher contract", () => {
  // Every StyleFamily literal exposed by the schema. New families are
  // picked up automatically; if the dispatcher or some composer's
  // acceptedStyleFamilies isn't updated to match, the inner test
  // fails here.
  for (const style of StyleFamilySchema.options) {
    it(`elaborates ${style} end-to-end without throwing`, async () => {
      const doc = buildDoc(style);
      const composer = getCoComposer(style);

      // The composer's accepted-set must include the style the
      // dispatcher just routed it for. (`getCoComposer` itself
      // already asserts this -- the test pins the invariant.)
      expect(composer.acceptedStyleFamilies.has(style)).toBe(true);

      const elaborated = await composer.elaborate(doc);

      // The elaborated doc must re-parse against the schema --
      // composers that emit a doc Zod would reject break the worker.
      const reparsed = SongDocumentSchema.safeParse(elaborated);
      expect(reparsed.success).toBe(true);

      // The user-facing style family must appear on every section's
      // tag list. This is how music-inference and the stem planner
      // see the delegated family rather than the composer's primary
      // family (e.g. sanskrit-shloka shows up as style:sanskrit-shloka,
      // not style:carnatic, even though CarnaticCoComposer is the
      // dispatched composer).
      for (const section of elaborated.sections) {
        expect(section.tags ?? []).toContain(`style:${style}`);
      }

      // Style family must be preserved on the doc itself.
      expect(elaborated.style_family).toBe(style);
    });
  }

  it("throws when a composer is given a style outside its accepted set", async () => {
    const composer = getCoComposer("carnatic");
    const westernDoc = buildDoc("western");
    await expect(composer.elaborate(westernDoc)).rejects.toThrow(
      /CarnaticCoComposer received style_family=western/,
    );
  });
});
