import { describe, expect, it, vi } from "vitest";
import { extractIntent, fallbackIntent, intentBlock, lyriaFragment, parseIntent, routeGenre } from "../lib/engine/intent";
import { FESTIVALS, GENRES, KEYWORDS, genreById, isVocalOnly } from "../lib/engine/genres";
import { deterministicChecks, judgeAndRetry, needsRetry } from "../lib/engine/judge";
import { dictionHints, dictionHintsFor } from "../lib/diction";
import { hostCascade, type CascadeReply, type HostCascadeDeps } from "../lib/cascade/host-cascade";

const ctx = (prompt: string, language: string, styleFamily = "western") => ({ prompt, language, styleFamily });

describe("genre catalog (from the styles research)", () => {
  it("has unique ids, sections, no excluded styles and no artist imitation in Lyria fragments", () => {
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length);
    expect(GENRES.length).toBeGreaterThan(70);
    for (const g of GENRES) {
      expect(g.forms.length, g.id).toBeGreaterThan(0);
      expect(["no", "na"]).not.toContain(g.vocal);
      expect(g.lyria, g.id).not.toMatch(/\b(in the style of|sounds like|imitat)/i);
    }
  });
  it("every routing keyword and festival style points at a usable style", () => {
    for (const [, id] of KEYWORDS) expect(genreById(id), id).toBeDefined();
    for (const f of FESTIVALS) for (const id of f.styles) expect(genreById(id), id).toBeDefined();
  });
});

describe("routeGenre", () => {
  it("routes by keyword and language", () => {
    expect(routeGenre(fallbackIntent("an abhang for the pandharpur wari"), ctx("an abhang for the pandharpur wari", "mr")).genre).toBe("mr-abhang");
    expect(routeGenre(fallbackIntent("bhavageete about the monsoon"), ctx("bhavageete about the monsoon", "kn", "kannada-light-classical")).genre).toBe("kn-bhavageethe");
    expect(routeGenre(fallbackIntent("garba for navratri"), ctx("garba for navratri", "gu")).genre).toBe("gu-garba-raas");
  });
  it("does not let a keyword from the wrong language win", () => {
    expect(routeGenre(fallbackIntent("abhang"), ctx("abhang", "ta")).genre).not.toBe("mr-abhang");
  });
  it("falls through keyword to occasion to daypart", () => {
    const diwali = routeGenre({ ...fallbackIntent("lights and sweets"), occasion: "Diwali" }, ctx("lights and sweets", "hi"));
    expect(diwali.genre).toBeDefined();
    expect(routeGenre(fallbackIntent("a calm song for early morning"), ctx("a calm song for early morning", "hi")).genre).toBeDefined();
  });
  it("leaves a plain brief alone (today's behaviour is the floor)", () => {
    expect(routeGenre(fallbackIntent("a song about my cat"), ctx("a song about my cat", "hi", "western")).genre).toBeUndefined();
  });
  it("uses the family default only for a deliberately classical family in a matching language", () => {
    expect(routeGenre(fallbackIntent("a song about rain"), ctx("a song about rain", "kn", "kannada-folk")).genre).toBe("kn-janapada");
    expect(routeGenre(fallbackIntent("a song about rain"), ctx("a song about rain", "ta", "kannada-folk")).genre).toBeUndefined();
  });
  it("never forwards an instrumental ask for a raga/folk/devotional style to Lyria", () => {
    const i = routeGenre({ ...fallbackIntent("khayal"), vocal: "instrumental" }, ctx("khayal in raga yaman", "hi", "hindustani"));
    expect(isVocalOnly(genreById(i.genre)!)).toBe(true);
    expect(lyriaFragment(i)).not.toMatch(/instrumental/i);
  });
});

describe("parseIntent / extractIntent", () => {
  it("drops unknown genre ids and caps lists", () => {
    const i = parseIntent({ essence: "a birthday wish", names: ["Asha", "Ravi", 3, ""], genre: "made-up", vocal: "robot", must_include: ["cake"] })!;
    expect(i.genre).toBeUndefined();
    expect(i.vocal).toBeUndefined();
    expect(i.names).toEqual(["Asha", "Ravi"]);
    expect(parseIntent({})).toBeNull();
  });
  it("falls back deterministically when the model fails or replies without JSON", async () => {
    const bad = await extractIntent(ctx("birthday song for Asha", "hi"), async () => { throw new Error("down"); });
    expect(bad.source).toBe("fallback");
    const nojson = await extractIntent(ctx("birthday song for Asha", "hi"), async () => "sorry");
    expect(nojson.essence).toContain("Asha");
  });
  it("builds the poet block and a Lyria fragment from the routed genre", async () => {
    const i = await extractIntent(ctx("a bhajan for Ganesh chaturthi for my grandmother Sarla", "hi"), async () =>
      JSON.stringify({ essence: "devotion for grandmother", occasion: "festival", names: ["Sarla"], genre: "bhajan-hindi", instruments: ["harmonium"], vocal: "female" }));
    expect(i.genre).toBe("bhajan-hindi");
    expect(intentBlock(i)).toContain("Sarla");
    expect(lyriaFragment(i)).toMatch(/harmonium/);
    expect(lyriaFragment(i)).toContain("female lead vocal");
  });
});

describe("deterministic checks and judge-retry", () => {
  const good = "[मुखड़ा]\nबारिश की बूँदें गाएँ\nघर की याद सुनाएँ\n[अंतरा]\nआसमान झुक आया\nमन ने गीत बनाया\nघर लौट आया\nदिल मुस्काया\nबादल बरसे\nहम न तरसे";
  it("flags wrong script, length and forbidden terms", () => {
    expect(deterministicChecks(good, { language: "hi", targetSeconds: 30, mustAvoid: [] }).scriptOk).toBe(true);
    expect(deterministicChecks("rain on the roof\nhome again", { language: "hi", targetSeconds: 30, mustAvoid: [] }).scriptOk).toBe(false);
    expect(deterministicChecks(good, { language: "hi", targetSeconds: 30, mustAvoid: ["बादल"] }).forbiddenHit).toEqual(["बादल"]);
    expect(deterministicChecks("एक\nदो", { language: "hi", targetSeconds: 60, mustAvoid: [] }).lineCountOk).toBe(false);
  });
  const intent = { ...fallbackIntent("song for Asha"), names: ["Asha"] };
  const verdict = (intent: number, names = true) => JSON.stringify({ intent, names_present: names, missing: names ? [] : ["Asha is not named"], natural: 4 });
  it("does nothing when the judge is satisfied", async () => {
    const complete = vi.fn(async () => verdict(5));
    const revise = vi.fn(async () => "never");
    const r = await judgeAndRetry({ intent, lyrics: good, language: "hi", targetSeconds: 30 }, { complete, revise });
    expect(r.retried).toBe(false);
    expect(revise).not.toHaveBeenCalled();
    expect(r.lyrics).toBe(good);
  });
  it("retries once on a missing name and keeps the revision when not worse", async () => {
    const revised = good.replace("घर लौट आया", "आशा घर आया");
    const complete = vi.fn().mockResolvedValueOnce(verdict(2, false)).mockResolvedValueOnce(verdict(5));
    const revise = vi.fn(async () => revised);
    const r = await judgeAndRetry({ intent, lyrics: good, language: "hi", targetSeconds: 30 }, { complete, revise, check: async () => true });
    expect(revise).toHaveBeenCalledTimes(1);
    expect(r.kept).toBe("revision");
    expect(r.lyrics).toBe(revised);
  });
  it("keeps the original when the revision is judged worse, fails safety, or errors", async () => {
    const worse = vi.fn().mockResolvedValueOnce(verdict(3, false)).mockResolvedValueOnce(verdict(1));
    expect((await judgeAndRetry({ intent, lyrics: good, language: "hi", targetSeconds: 30 }, { complete: worse, revise: async () => good + "\nऔर", check: async () => true })).kept).toBe("original");
    const unsafe = vi.fn(async () => verdict(2, false));
    expect((await judgeAndRetry({ intent, lyrics: good, language: "hi", targetSeconds: 30 }, { complete: unsafe, revise: async () => good + "\nऔर", check: async () => false })).kept).toBe("original");
    const boom = await judgeAndRetry({ intent, lyrics: good, language: "hi", targetSeconds: 30 }, { complete: unsafe, revise: async () => { throw new Error("x"); } });
    expect(boom.lyrics).toBe(good);
  });
  it("a judge that cannot answer never triggers a retry on its own", () => {
    expect(needsRetry(null, deterministicChecks(good, { language: "hi", targetSeconds: 30, mustAvoid: [] }))).toBe(false);
  });
});

describe("dictionHintsFor", () => {
  it("is empty for launch codes by default (today's behaviour) and resolved under the flag", () => {
    expect(dictionHintsFor("kn", {})).toBe("");
    expect(dictionHintsFor("kn", { DICTION_HINTS_LAUNCH: "1" })).toBe(dictionHints("kannada"));
    expect(dictionHintsFor("hi", { DICTION_HINTS_LAUNCH: "1" })).toMatch(/schwa/i);
    expect(dictionHintsFor("mr", {})).toBe(dictionHints("marathi")); // expansion codes already resolve
    expect(dictionHintsFor("en", { DICTION_HINTS_LAUNCH: "1" })).toBe("");
  });
});

describe("hostCascade with PCE_INTENT", () => {
  const brief = { language: "hi", styleFamily: "hindustani", targetSeconds: 30, prompt: "a bhajan for my grandmother Sarla" };
  function deps() {
    const prompts: string[] = [];
    const d: HostCascadeDeps = {
      complete: vi.fn(async ({ prompt }) => {
        prompts.push(prompt);
        if (prompt.startsWith("You read a listener")) return JSON.stringify({ essence: "devotion for grandmother", names: ["Sarla"], genre: "bhajan-hindi", vocal: "female" });
        if (prompt.startsWith("Plan a")) return '{"topic":"grandmother devotion","constraint":"hindi bhajan"}';
        if (prompt.includes('{"title"')) return '{"title":"सरला","style_prompt":"devotional harmonium"}';
        return "[मुखड़ा]\nराम नाम";
      }),
      cascade: vi.fn(async (body): Promise<CascadeReply> => {
        if (!body.generations.draft.length) return { status: "needs", kind: "draft", prompts: ["p1", "p2"] };
        if (!body.generations.revision.length) return { status: "needs", kind: "revision", prompts: ["r1", "r2"] };
        return { status: "done", result: { surface: "[मुखड़ा]\nराम नाम", committed: "revision" } };
      }),
    };
    return { d, prompts };
  }
  it("is inert without the flag", async () => {
    const { d, prompts } = deps();
    const s = await hostCascade(brief, d, 2, {});
    expect(s.intent).toBeUndefined();
    expect(prompts.some((p) => p.startsWith("You read a listener"))).toBe(false);
  });
  it("threads intent into poets and the Lyria style prompt under the flag", async () => {
    const { d, prompts } = deps();
    const s = await hostCascade(brief, d, 2, { PCE_INTENT: "1" });
    expect(s.intent?.genre).toBe("bhajan-hindi");
    expect(prompts.filter((p) => p.includes("Listener intent")).length).toBe(4);
    expect(prompts.find((p) => p.includes("Names to weave"))).toContain("Sarla");
    expect(s.stylePrompt).toContain(genreById("bhajan-hindi")!.lyria.slice(0, 20));
    expect(s.stylePrompt).toContain("female lead vocal");
  });
});
