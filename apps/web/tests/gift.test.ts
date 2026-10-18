import { describe, expect, it } from "vitest";

import {
  GIFT_LANGUAGES,
  GIFT_NOTE_MAX,
  OCCASIONS,
  RELATIONSHIPS,
  giftShareUrl,
  occasionById,
  planGift,
} from "@/lib/gift/occasions";

const base = { occasion: "diwali", relationship: "mother", language: "hi", name: "Amma" };

describe("planGift", () => {
  it("builds a brief that names the recipient and keeps Diwali first in the picker", () => {
    const r = planGift({ ...base, note: "makes the best laddoos" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.prompt).toContain("Diwali");
    expect(r.plan.prompt).toContain("Amma, my mother");
    expect(r.plan.prompt).toContain("makes the best laddoos");
    expect(r.plan.prompt.length).toBeLessThanOrEqual(500);
    expect(r.plan.styleFamily).toBe("bollywood-ballad");
    expect(r.plan.to).toBe("Amma");
    expect(r.plan.message).toBe("makes the best laddoos");
    expect(OCCASIONS.slice(0, 2).map((o) => o.id)).toEqual(["diwali", "dhanteras"]);
  });

  it("keeps the brief within 500 chars at the longest name and note", () => {
    for (const o of OCCASIONS) {
      const r = planGift({ ...base, occasion: o.id, relationship: "spouse", name: "x".repeat(60), note: "y".repeat(GIFT_NOTE_MAX) });
      expect(r.ok && r.plan.prompt.length).toBeLessThanOrEqual(500);
    }
  });

  it("strips control and bidi characters from name and note", () => {
    const r = planGift({ ...base, name: "  Priya‮ ", note: "hi\u0007 there" });
    expect(r.ok && [r.plan.to, r.plan.message]).toEqual(["Priya", "hi there"]);
  });

  it("rejects unknown ids, non-launch languages and empty or oversized fields", () => {
    expect(planGift({ ...base, occasion: "nope" })).toEqual({ ok: false, error: "invalid_request" });
    expect(planGift({ ...base, relationship: "nope" })).toEqual({ ok: false, error: "invalid_request" });
    expect(planGift({ ...base, language: "en" })).toEqual({ ok: false, error: "invalid_request" });
    expect(planGift({ ...base, name: "   " })).toEqual({ ok: false, error: "name_required" });
    expect(planGift({ ...base, name: "n".repeat(61) })).toEqual({ ok: false, error: "name_too_long" });
    expect(planGift({ ...base, note: "n".repeat(GIFT_NOTE_MAX + 1) })).toEqual({ ok: false, error: "note_too_long" });
  });

  it("maps every launch language to a style", () => {
    for (const language of GIFT_LANGUAGES) expect(planGift({ ...base, language }).ok).toBe(true);
  });
});

describe("gift catalog", () => {
  it("labels every occasion and relationship in all six UI languages", () => {
    for (const item of [...OCCASIONS, ...RELATIONSHIPS]) {
      for (const l of ["en", ...GIFT_LANGUAGES] as const) expect(item.label[l].trim(), `${item.id}:${l}`).not.toBe("");
    }
  });

  it("looks occasions up by id and ignores unknown ids", () => {
    expect(occasionById("holi")?.id).toBe("holi");
    expect(occasionById("x")).toBeNull();
    expect(occasionById(undefined)).toBeNull();
  });
});

describe("giftShareUrl", () => {
  it("encodes the greeting and link for wa.me", () => {
    const u = giftShareUrl({ name: "Amma", occasion: "Diwali", url: "https://x.app/s/abc" });
    const text = decodeURIComponent(u.split("text=")[1]!);
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    expect(text).toContain("Diwali");
    expect(text).toContain("Amma");
    expect(text).toContain("https://x.app/s/abc");
  });
});
