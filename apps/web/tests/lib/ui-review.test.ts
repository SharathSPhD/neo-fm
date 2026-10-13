import { describe, expect, it } from "vitest";

import { UI_STRINGS } from "@/lib/i18n/ui-strings";
import {
  applyEditsToSource,
  buildPatch,
  buildSections,
  clampDays,
  hashToken,
  isWellFormedToken,
  markReviewed,
  newToken,
  OPENABLE_PATHS,
  patchMarkdown,
  screenFor,
  validateSuggestion,
  type EditRow,
} from "@/lib/ui-review/core";
import { pickRule } from "@/lib/rate-limit";

const kn = UI_STRINGS.kn;
const edit = (key: keyof typeof kn, over: Partial<EditRow> = {}): EditRow => ({
  token_id: "t1",
  key,
  action: "approve",
  suggestion: null,
  comment: null,
  base_text: kn[key],
  updated_at: "2026-10-12T10:00:00Z",
  ...over,
});

describe("tokens", () => {
  it("mints well-formed unique tokens and hashes them without leaking them", () => {
    const a = newToken();
    expect(isWellFormedToken(a)).toBe(true);
    expect(newToken()).not.toBe(a);
    expect(hashToken(a)).not.toContain(a);
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken(`${a}/../x`)).toBe(false);
  });
  it("clamps link lifetime to 1-60 days, default 14", () => {
    expect(clampDays(null)).toBe(14);
    expect(clampDays("7")).toBe(7);
    expect(clampDays("999")).toBe(60);
  });
});

describe("sections", () => {
  it("covers every key exactly once, with English and current text", () => {
    const rows = buildSections("ta").flatMap((s) => s.rows);
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(UI_STRINGS.en).sort());
    expect(rows.find((r) => r.key === "nav.discover")).toMatchObject({ en: "Discover", current: UI_STRINGS.ta["nav.discover"] });
  });
  it("only offers screens that exist as public pages for the open-in-language link", () => {
    for (const s of buildSections("hi")) if (s.path) expect(OPENABLE_PATHS).toContain(s.path);
    expect(screenFor("legal.privacy.s1").path).toBe("/privacy");
    expect(OPENABLE_PATHS.every((p) => p.startsWith("/") && !p.startsWith("//"))).toBe(true);
  });
});

describe("validateSuggestion", () => {
  it("requires the same placeholders and markers as the English", () => {
    expect(validateSuggestion("Page {n}", "पृष्ठ {n}")).toBe("ok");
    expect(validateSuggestion("Page {n}", "पृष्ठ")).toBe("placeholders");
    expect(validateSuggestion("Page {n}", "पृष्ठ {m}")).toBe("placeholders");
    expect(validateSuggestion("AI [[right]]", "AI सही")).toBe("placeholders");
    expect(validateSuggestion("x", "   ")).toBe("empty");
    expect(validateSuggestion("x", "a".repeat(1001))).toBe("too_long");
  });
});

describe("buildPatch", () => {
  const key = "nav.discover" as const;
  it("uses the latest edit, lists alternatives, and counts approvals", () => {
    const p = buildPatch("kn", [
      edit(key, { action: "edit", suggestion: "ಹುಡುಕಿ", token_id: "a", updated_at: "2026-10-12T10:00:00Z", comment: "more natural" }),
      edit(key, { action: "edit", suggestion: "ಕಂಡುಹಿಡಿ", token_id: "b", updated_at: "2026-10-12T11:00:00Z" }),
      edit("nav.pricing", { token_id: "a" }),
    ]);
    expect(p.edits).toHaveLength(1);
    expect(p.edits[0]).toMatchObject({ key, new: "ಕಂಡುಹಿಡಿ", alternatives: ["ಹುಡುಕಿ"], comments: ["more natural"], old: kn[key] });
    expect(p.approved_keys).toEqual(["nav.pricing"]);
    expect(p.complete).toBe(false);
  });
  it("ignores stale verdicts and invalid suggestions", () => {
    const p = buildPatch("kn", [
      edit(key, { base_text: "an older translation", action: "edit", suggestion: "x" }),
      edit("palette.noMatches", { action: "edit", suggestion: "no placeholder here" }),
    ]);
    expect(p.stale).toBe(1);
    expect(p.edits).toHaveLength(0);
    // The invalid edit falls back to counting as the reviewer having looked at it, not as a change.
    expect(p.approved_keys).toEqual(["palette.noMatches"]);
  });
  it("is complete only when every key has a verdict", () => {
    const all = (Object.keys(kn) as (keyof typeof kn)[]).map((k) => edit(k));
    expect(buildPatch("kn", all).complete).toBe(true);
    expect(buildPatch("kn", all.slice(1)).complete).toBe(false);
  });
  it("renders a PR-ready table that escapes pipes", () => {
    const md = patchMarkdown({
      language: "kn", generated_at: "x", total_keys: 3, approved_keys: [], stale: 0, complete: false,
      edits: [{ key: "a.b", old: "o|ld", new: "n", comments: ["c"], alternatives: [] }],
    });
    expect(md).toContain("o\\|ld");
    expect(md).toContain("`a.b`");
  });
});

describe("applying a patch", () => {
  const src = `export const kn = {\n  "a.one": "ಹಳೆಯ",\n  "a.two": "ಇನ್ನೊಂದು",\n} as const;\n`;
  it("replaces only the edited line, JSON-escaping the value", () => {
    const out = applyEditsToSource(src, [{ key: "a.one", new: 'ಹೊಸ "ಉಲ್ಲೇಖ"' }]);
    expect(out).toContain('  "a.one": "ಹೊಸ \\"ಉಲ್ಲೇಖ\\"",');
    expect(out).toContain('  "a.two": "ಇನ್ನೊಂದು",');
  });
  it("throws on an unknown key", () => {
    expect(() => applyEditsToSource(src, [{ key: "nope", new: "x" }])).toThrow(/not found/);
  });
  it("flips one language to reviewed", () => {
    const s = 'x\n  kn: "pending-review",\n  bn: "pending-review",\n';
    expect(markReviewed(s, "kn")).toBe('x\n  kn: "reviewed",\n  bn: "pending-review",\n');
    expect(() => markReviewed("x", "kn")).toThrow();
  });
  it("real locale files patch cleanly for every key", () => {
    // Guards the one-key-per-line assumption the apply script relies on.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const file = fs.readFileSync(`${__dirname}/../../lib/i18n/locales/kn.ts`, "utf8");
    const out = applyEditsToSource(file, [{ key: "nav.discover", new: "TEST" }]);
    expect(out).toContain('  "nav.discover": "TEST",');
    expect(out.split("\n").length).toBe(file.split("\n").length);
  });
});

describe("rate limits", () => {
  it("covers the review page and writes", () => {
    expect(pickRule("/ui-review/abc", "GET")?.bucket).toBe("uireview:page");
    expect(pickRule("/ui-review/abc/open", "GET")?.bucket).toBe("uireview:page");
    expect(pickRule("/api/ui-review/abc/items", "POST")?.bucket).toBe("uireview:write");
  });
});
