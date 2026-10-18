import { describe, expect, it } from "vitest";

import { IDEAS, ideaById, ideasFor } from "@/lib/ideas/catalog";
import { facetCounts, filterIdeas, IDEA_LANGS, isIdeaLang, MOODS, OCCASIONS, PROMPT_LIMIT, type IdeaLang, type Occasion } from "@/lib/ideas/types";

const SCRIPT: Record<IdeaLang, RegExp> = {
  hi: /[ऀ-ॿ]/,
  kn: /[ಀ-೿]/,
  ta: /[஀-௿]/,
  te: /[ఀ-౿]/,
  bn: /[ঀ-৿]/,
};
const WANT: Record<Occasion, number> = { festival: 3, lullaby: 2, love: 3, devotion: 3, monsoon: 2, cricket: 2, wedding: 3, "city-life": 2 };

describe("ideas catalog", () => {
  it("has 20 ideas per launch language with the planned occasion mix", () => {
    for (const lang of IDEA_LANGS) {
      const list = ideasFor(lang);
      expect(list, lang).toHaveLength(20);
      for (const o of OCCASIONS) expect(list.filter((i) => i.occasion === o), `${lang}/${o}`).toHaveLength(WANT[o]);
    }
  });

  it("has unique stable ids and no duplicate prompts", () => {
    expect(new Set(IDEAS.map((i) => i.id)).size).toBe(IDEAS.length);
    expect(new Set(IDEAS.map((i) => i.text)).size).toBe(IDEAS.length);
    for (const i of IDEAS) expect(i.id).toMatch(new RegExp(`^${i.lang}-${i.occasion}-\\d+$`));
  });

  it("writes every idea natively: right script, no Latin letters, fits the create box", () => {
    for (const i of IDEAS) {
      expect(i.text, i.id).toMatch(SCRIPT[i.lang]);
      expect(i.text, `${i.id} has Latin letters`).not.toMatch(/[A-Za-z]/);
      expect(i.text.length, i.id).toBeGreaterThanOrEqual(40);
      expect(i.text.length, i.id).toBeLessThanOrEqual(PROMPT_LIMIT);
      expect((MOODS as readonly string[]).includes(i.mood), i.id).toBe(true);
    }
  });

  it("gives every idea an English gloss", () => {
    for (const i of IDEAS) {
      expect(i.gloss.length, i.id).toBeGreaterThanOrEqual(15);
      expect(i.gloss, i.id).toMatch(/[A-Za-z]/);
    }
  });
});

describe("helpers", () => {
  const kn = ideasFor("kn");
  it("looks ideas up by id and rejects unknown ids", () => {
    const first = kn[0]!;
    expect(ideaById(first.id)).toEqual(first);
    expect(ideaById("nope")).toBeNull();
    expect(ideaById(null)).toBeNull();
    expect(ideaById("__proto__")).toBeNull();
  });
  it("validates languages", () => {
    expect(isIdeaLang("ta")).toBe(true);
    expect(isIdeaLang("en")).toBe(false);
    expect(isIdeaLang(undefined)).toBe(false);
  });
  it("filters by occasion and mood together", () => {
    const wed = filterIdeas(kn, { occasion: "wedding" });
    expect(wed).toHaveLength(3);
    expect(filterIdeas(kn, {})).toHaveLength(20);
    const m = wed[0]!.mood;
    expect(filterIdeas(kn, { occasion: "wedding", mood: m }).every((i) => i.occasion === "wedding" && i.mood === m)).toBe(true);
  });
  it("facet counts reflect the other active filter and never promise an empty result", () => {
    const c = facetCounts(kn, { occasion: "wedding" });
    expect(c.occasion.wedding).toBe(3);
    expect(Object.values(c.mood).reduce((a, b) => a + b, 0)).toBe(3);
    for (const m of MOODS) if (c.mood[m] > 0) expect(filterIdeas(kn, { occasion: "wedding", mood: m }).length).toBe(c.mood[m]);
  });
});
