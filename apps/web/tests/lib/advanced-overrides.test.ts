/**
 * v1.4 Sprint 4 — Unit tests for the pure helpers exported from
 * `creation-canvas.tsx`. These are the contract that the dialog UI
 * and any future automation rely on, so they get full coverage here.
 */
import { describe, expect, it } from "vitest";

import {
  applyAdvancedOverrides,
  buildSongDocument,
} from "../../app/(app)/songs/new/creation-canvas";
import {
  EMPTY_ADVANCED_STATE,
  parseSectionTagsRaw,
  type AdvancedState,
} from "../../app/(app)/songs/new/advanced-disclosure";

const BASE_DOC = {
  language: "en",
  style_family: "western",
  target_duration_seconds: 90,
  sections: [{ id: "s1", type: "verse", target_seconds: 90 }],
};

function adv(over: Partial<AdvancedState>): AdvancedState {
  return { ...EMPTY_ADVANCED_STATE, ...over };
}

describe("applyAdvancedOverrides", () => {
  it("returns the base doc unchanged when state is empty", () => {
    const out = applyAdvancedOverrides(BASE_DOC, EMPTY_ADVANCED_STATE, "western");
    expect(out).toEqual(BASE_DOC);
    expect(out).not.toBe(BASE_DOC);
  });

  it("stamps tempo when in range, ignores out-of-range and non-numeric", () => {
    expect(
      applyAdvancedOverrides(BASE_DOC, adv({ tempoBpm: 120 }), "western").tempo_bpm,
    ).toBe(120);
    expect(
      applyAdvancedOverrides(BASE_DOC, adv({ tempoBpm: 999 }), "western").tempo_bpm,
    ).toBeUndefined();
    expect(
      applyAdvancedOverrides(BASE_DOC, adv({ tempoBpm: "" }), "western").tempo_bpm,
    ).toBeUndefined();
  });

  it("stamps metadata.key on Western styles only", () => {
    const western = applyAdvancedOverrides(
      BASE_DOC,
      adv({ key: "F#m" }),
      "western",
    );
    expect((western.metadata as Record<string, unknown>).key).toBe("F#m");

    const bollywood = applyAdvancedOverrides(
      BASE_DOC,
      adv({ key: "G" }),
      "bollywood-ballad",
    );
    expect((bollywood.metadata as Record<string, unknown>).key).toBe("G");

    const carnatic = applyAdvancedOverrides(
      { ...BASE_DOC, style_family: "carnatic" },
      adv({ key: "C" }),
      "carnatic",
    );
    expect(carnatic.metadata).toBeUndefined();
  });

  it("stamps raga only when both name and system are set, lowercases the name", () => {
    expect(
      applyAdvancedOverrides(
        { ...BASE_DOC, style_family: "carnatic" },
        adv({ ragaName: "Yaman", ragaSystem: "hindustani" }),
        "carnatic",
      ).raga,
    ).toEqual({ name: "yaman", system: "hindustani" });

    expect(
      applyAdvancedOverrides(
        BASE_DOC,
        adv({ ragaName: "yaman", ragaSystem: "" }),
        "western",
      ).raga,
    ).toBeUndefined();
  });

  it("stamps tala when non-empty", () => {
    expect(
      applyAdvancedOverrides(BASE_DOC, adv({ tala: " adi " }), "carnatic").tala,
    ).toBe("adi");
  });

  it("merges orchestration overrides without dropping inherited fields", () => {
    const base = { ...BASE_DOC, orchestration: { texture: "layered" } };
    const out = applyAdvancedOverrides(
      base,
      adv({ leadVocal: "female", instruments: ["sitar", "tabla"] }),
      "hindustani",
    );
    expect(out.orchestration).toEqual({
      texture: "layered",
      lead_vocal: "female",
      instruments: ["sitar", "tabla"],
    });
  });

  it("merges background_mix without dropping inherited fields", () => {
    const base = { ...BASE_DOC, background_mix: { reverb: "hall" } };
    const out = applyAdvancedOverrides(
      base,
      adv({ density: "dense", dynamics: "energetic" }),
      "western",
    );
    expect(out.background_mix).toEqual({
      reverb: "hall",
      accompaniment_density: "dense",
      dynamics: "energetic",
    });
  });

  it("appends parsed section tags to every section", () => {
    const out = applyAdvancedOverrides(
      BASE_DOC,
      adv({ sectionTagsRaw: "mood:bright\ncrowd:wedding" }),
      "western",
    );
    expect((out.sections as { tags: string[] }[])[0]!.tags).toEqual([
      "mood:bright",
      "crowd:wedding",
    ]);
  });
});

describe("parseSectionTagsRaw", () => {
  it("returns [] for empty / whitespace input", () => {
    expect(parseSectionTagsRaw("")).toEqual([]);
    expect(parseSectionTagsRaw("   \n\n  \n")).toEqual([]);
  });
  it("skips lines without a `:`", () => {
    expect(parseSectionTagsRaw("a:b\njust prose\nkey:value")).toEqual([
      "a:b",
      "key:value",
    ]);
  });
  it("trims each line", () => {
    expect(parseSectionTagsRaw("  mood:bright  \n\n  key:value\n")).toEqual([
      "mood:bright",
      "key:value",
    ]);
  });
});

describe("buildSongDocument", () => {
  const presetDoc = {
    language: "kn",
    style_family: "kannada-light-classical",
    target_duration_seconds: 90,
    sections: [{ id: "s1", type: "pallavi", target_seconds: 90 }],
    raga: { name: "mohanam", system: "light-classical" },
  };
  const PRESET = {
    id: "p1",
    title: "Bhavageete",
    description: null,
    style_family: "kannada-light-classical",
    language: "kn",
    target_duration_seconds: 90,
    accent_color: null,
    cover_image_url: null,
    is_active: true,
    sort_order: 0,
    song_document: presetDoc,
  } as unknown as Parameters<typeof buildSongDocument>[1];

  it("inherits preset raga when no advanced override", () => {
    const doc = buildSongDocument(
      {
        style_family: "kannada-light-classical",
        language: "kn",
        target_duration_seconds: 90,
      },
      PRESET,
      [{ id: "s1", type: "pallavi", target_seconds: 90 }],
      "",
      EMPTY_ADVANCED_STATE,
    );
    expect(doc.raga).toEqual({ name: "mohanam", system: "light-classical" });
  });

  it("advanced raga override beats preset raga", () => {
    const doc = buildSongDocument(
      {
        style_family: "kannada-light-classical",
        language: "kn",
        target_duration_seconds: 90,
      },
      PRESET,
      [{ id: "s1", type: "pallavi", target_seconds: 90 }],
      "",
      adv({ ragaName: "kalyani", ragaSystem: "carnatic" }),
    );
    expect(doc.raga).toEqual({ name: "kalyani", system: "carnatic" });
  });
});
