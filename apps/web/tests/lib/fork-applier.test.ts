/**
 * Unit tests for `lib/song/fork-applier.ts` — the shared mutation
 * helper that variation + remix both call.
 */
import { describe, expect, it } from "vitest";

import { applyForkToDoc, type ParentDocLike } from "../../lib/song/fork-applier";

function basicWestern(): ParentDocLike {
  return {
    style_family: "western",
    title: "Streetlights",
    tempo_bpm: 110,
    target_duration_seconds: 90,
    metadata: { key: "C" },
    sections: [
      { id: "v1", type: "verse", target_seconds: 30 },
      { id: "c1", type: "chorus", target_seconds: 30 },
      { id: "v2", type: "verse", target_seconds: 30 },
    ],
  } as ParentDocLike;
}

function basicCarnatic(): ParentDocLike {
  return {
    style_family: "carnatic",
    title: "Saveri Krithi",
    tempo_bpm: 80,
    raga: { name: "saveri", system: "carnatic" },
    target_duration_seconds: 90,
    sections: [
      { id: "p1", type: "pallavi", target_seconds: 30 },
      { id: "a1", type: "anupallavi", target_seconds: 30 },
      { id: "c1", type: "charanam", target_seconds: 30 },
    ],
  } as ParentDocLike;
}

describe("applyForkToDoc", () => {
  it("preserves the parent doc when the body is empty (variation)", () => {
    const parent = basicWestern();
    const r = applyForkToDoc(
      parent,
      {},
      {
        kind: "variation",
        appendRemixSuffix: false,
        defaultDistance: 25,
      },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.doc.title).toBe("Streetlights");
    expect(r.doc.tempo_bpm).toBe(110);
    expect(r.doc.metadata).toMatchObject({
      fork: { kind: "variation", distance: 25 },
    });
  });

  it("appends (remix) and jitters tempo on a remix with empty body", () => {
    const parent = basicWestern();
    const r = applyForkToDoc(
      parent,
      {},
      {
        kind: "remix",
        appendRemixSuffix: true,
        defaultDistance: 65,
      },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.doc.title).toBe("Streetlights (remix)");
    expect(r.doc.tempo_bpm).not.toBe(110);
    expect(r.doc.tempo_bpm).toBeGreaterThanOrEqual(30);
    expect(r.doc.tempo_bpm).toBeLessThanOrEqual(240);
    expect(r.doc.metadata).toMatchObject({
      fork: { kind: "remix", distance: 65 },
    });
  });

  it("honours explicit tempo / title overrides", () => {
    const parent = basicWestern();
    const r = applyForkToDoc(
      parent,
      { tempo_bpm: 140, title: "Streetlights at noon" },
      {
        kind: "remix",
        appendRemixSuffix: true,
        defaultDistance: 65,
      },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.doc.title).toBe("Streetlights at noon");
    expect(r.doc.tempo_bpm).toBe(140);
  });

  it("rejects key_override on non-Western styles", () => {
    const parent = basicCarnatic();
    const r = applyForkToDoc(
      parent,
      { key_override: "C" },
      {
        kind: "variation",
        appendRemixSuffix: false,
        defaultDistance: 25,
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toBe("key_override_not_western");
  });

  it("accepts key_override on Western and stamps metadata.key", () => {
    const parent = basicWestern();
    const r = applyForkToDoc(
      parent,
      { key_override: "F#m" },
      {
        kind: "variation",
        appendRemixSuffix: false,
        defaultDistance: 25,
      },
    );
    if (!r.ok) throw new Error("expected ok");
    expect((r.doc.metadata as Record<string, unknown>).key).toBe("F#m");
  });

  it("rejects raga_override on Western", () => {
    const parent = basicWestern();
    const r = applyForkToDoc(
      parent,
      { raga_override: { name: "yaman", system: "hindustani" } },
      {
        kind: "remix",
        appendRemixSuffix: true,
        defaultDistance: 65,
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toBe("raga_incompatible_with_style");
  });

  it("rejects an incompatible raga.system for Carnatic", () => {
    const parent = basicCarnatic();
    const r = applyForkToDoc(
      parent,
      { raga_override: { name: "yaman", system: "hindustani" } },
      {
        kind: "remix",
        appendRemixSuffix: true,
        defaultDistance: 65,
      },
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a compatible raga.system for Carnatic", () => {
    const parent = basicCarnatic();
    const r = applyForkToDoc(
      parent,
      { raga_override: { name: "kalyani", system: "carnatic" } },
      {
        kind: "remix",
        appendRemixSuffix: true,
        defaultDistance: 65,
      },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.doc.raga).toEqual({ name: "kalyani", system: "carnatic" });
  });

  it("stamps voice_id and section_ids into the doc", () => {
    const parent = basicWestern();
    const r = applyForkToDoc(
      parent,
      { voice_id: "kn-female-warm-01", section_ids: ["v1", "c1"] },
      {
        kind: "variation",
        appendRemixSuffix: false,
        defaultDistance: 25,
      },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.doc.voice_id).toBe("kn-female-warm-01");
    expect(
      (r.doc.metadata as Record<string, unknown>).fork,
    ).toMatchObject({ section_ids: ["v1", "c1"] });
  });

  it("clones the parent (doesn't mutate the input)", () => {
    const parent = basicWestern();
    const before = JSON.stringify(parent);
    applyForkToDoc(
      parent,
      { tempo_bpm: 222, title: "X" },
      {
        kind: "remix",
        appendRemixSuffix: true,
        defaultDistance: 65,
      },
    );
    expect(JSON.stringify(parent)).toBe(before);
  });
});
