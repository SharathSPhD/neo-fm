import { describe, expect, it } from "vitest";

import { chrome, LATEST_ID, pick, WHATS_NEW, WHATS_NEW_LANGS } from "../lib/whats-new/entries";

describe("what's new", () => {
  it("has unique ids, ISO dates, and English text for every entry", () => {
    const ids = WHATS_NEW.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of WHATS_NEW) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.en.length).toBeGreaterThan(0);
      expect(e.body.en.length).toBeGreaterThan(0);
    }
    expect(LATEST_ID).toBe(WHATS_NEW[0]!.id);
  });

  it("falls back to English when a language has no translation", () => {
    const e = WHATS_NEW[0]!;
    expect(pick(e.title, "te")).toBe(e.title.en);
    expect(pick(e.title, "hi")).toBe(e.title.hi ?? e.title.en);
    expect(chrome("title", "kn")).toBe("What's new");
  });

  it("never leaks internal jargon or PR numbers into user copy", () => {
    for (const e of WHATS_NEW) for (const l of WHATS_NEW_LANGS) {
      expect(pick(e.title, l) + pick(e.body, l)).not.toMatch(/#\d+|\bPR\b|migration|webhook|RLS/i);
    }
  });
});
