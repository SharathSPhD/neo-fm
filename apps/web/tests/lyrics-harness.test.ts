import { describe, expect, it } from "vitest";
import { parseCritique, parseSelect } from "../lib/lyrics/harness/critique";
import { estimateArmUsd } from "../lib/lyrics/harness/cost";
import { exemplarBlock, overlapRatio, retrieveExemplars, type Exemplar } from "../lib/lyrics/harness/exemplars";
import { ARMS, runHarness, type HarnessDeps } from "../lib/lyrics/harness/harness";

const pool: Exemplar[] = [
  { id: "a", lang: "kn", style: "kannada-folk", brief: "farmers waiting for rain in the village", text: "ಅ\nಆ", judge: 4 },
  { id: "b", lang: "kn", style: "kannada-pop", brief: "a love song at the sea", text: "ಇ\nಈ", judge: 4.5 },
  { id: "c", lang: "ta", style: "tamil-pop", brief: "farmers waiting for rain", text: "அ", judge: 5 },
];

describe("exemplar retrieval", () => {
  it("stays in the language and prefers the matching style and brief", () => {
    const r = retrieveExemplars({ language: "Kannada", style: "kannada-folk", brief: "Farmers waiting for the first rain" }, 2, pool);
    expect(r.map((e) => e.id)).toEqual(["a", "b"]);
    expect(retrieveExemplars({ language: "Bengali", style: "x", brief: "rain" }, 3, pool)).toEqual([]);
  });
  it("serves the shipped English refs for an English country brief", () => {
    const r = retrieveExemplars({ language: "English", style: "english-country", brief: "a diner closing after forty years" }, 3);
    expect(r.length).toBe(3);
    expect(r.every((e) => e.lang === "en")).toBe(true);
    expect(playbookFor("English")).toContain("CRAFT RULES");
  });
  it("overlap guard flags an echoed exemplar", () => {
    const t = "ಕಾರುಣ್ಯದ ಮಳೆಯು ಸುರಿವ ತವಕದಿ ದಾರಿ ತೋರಿಸು ಕೃಷ್ಣ";
    expect(overlapRatio(t, t)).toBe(1);
    expect(overlapRatio(t, "ಬೇರೆಯದೇ ಹಾಡು ಇದು")).toBeLessThan(0.2);
  });
  it("renders nothing for no exemplars", () => expect(exemplarBlock([])).toBe(""));
});

describe("critique parsing", () => {
  const ok = { scores: { prosody: 3, diction: 2, imagery: 3, cultural: 3, originality: 2, fidelity: 4 }, weak: [{ line: "x", problem: "p", direction: "d" }], verdict: "revise" };
  it("parses a valid critique and forces keep when nothing is weak", () => {
    expect(parseCritique(JSON.stringify(ok))?.verdict).toBe("revise");
    expect(parseCritique(JSON.stringify({ ...ok, weak: [], verdict: "revise" }))?.verdict).toBe("keep");
  });
  it("rejects out-of-range scores and non-JSON", () => {
    expect(parseCritique(JSON.stringify({ ...ok, scores: { ...ok.scores, diction: 9 } }))).toBeNull();
    expect(parseCritique("nope")).toBeNull();
  });
  it("select pick is bounds-checked", () => {
    expect(parseSelect('{"best":2}', 3)).toBe(1);
    expect(parseSelect('{"best":4}', 3)).toBeNull();
  });
});

function deps(over: Partial<Omit<HarnessDeps, "prefers">> & { prefers?: boolean } = {}) {
  const calls: string[] = [];
  const d: HarnessDeps = {
    polish: async (a) => { calls.push("polish"); return `P(${a.lyrics})`; },
    ask: async (a) => {
      if (a.prompt.includes("harsh but fair")) { calls.push("critique"); return JSON.stringify({ scores: { prosody: 3, diction: 3, imagery: 3, cultural: 3, originality: 3, fidelity: 3 }, weak: [{ line: "l", problem: "p", direction: "d" }], verdict: "revise" }); }
      if (a.prompt.includes("Rewrite ONLY")) { calls.push("revise"); return "REVISED lyric text here, long enough"; }
      calls.push("select"); return '{"best":1}';
    },
    ...over,
    prefers: async () => over.prefers ?? true,
  };
  return { d, calls };
}
const input = { language: "Kannada", style: "kannada-folk", brief: "rain", drafts: ["d1", "d2", "d3"] };

describe("runHarness", () => {
  it("live arm is exactly one polish call", async () => {
    const { d, calls } = deps();
    const r = await runHarness(ARMS.live!, input, d);
    expect(calls).toEqual(["polish"]);
    expect(r.lyrics).toBe("P(d1)");
  });
  it("keeps a revision the judge prefers, and drops one it does not", async () => {
    const kept = await runHarness(ARMS.revise!, input, deps().d);
    expect(kept.lyrics).toMatch(/^REVISED/);
    const dropped = await runHarness(ARMS.revise!, input, deps({ prefers: false }).d);
    expect(dropped.lyrics).toBe("P(d1)");
    expect(dropped.trace.join()).toMatch(/rejected by judge/);
  });
  it("candidates polish several drafts and select one", async () => {
    const { d, calls } = deps();
    await runHarness({ ...ARMS.live!, candidates: 3 }, input, d);
    expect(calls).toEqual(["polish", "polish", "polish", "select"]);
  });
  it("puts retrieved exemplars into the polish brief", async () => {
    let seen = "";
    const { d } = deps({ polish: async (a) => { seen = a.brief; return "x".repeat(30); } });
    await runHarness({ ...ARMS.live!, exemplars: 2 }, { ...input, brief: "Farmers waiting for the first rain; call-and-response chorus" }, d);
    expect(seen).toMatch(/QUALITY REFERENCES/);
  });
});

describe("estimate", () => {
  it("grows with each lever", () => {
    expect(estimateArmUsd(ARMS.refs!)).toBeGreaterThan(estimateArmUsd(ARMS.live!));
    expect(estimateArmUsd(ARMS.full!)).toBeGreaterThan(estimateArmUsd(ARMS.refs_revise!));
  });
});

import { refsContext } from "../lib/lyrics/harness/harness";
import { playbookFor } from "../lib/lyrics/harness/playbook";
describe("refsContext (PCE_HARNESS_REFS)", () => {
  it("builds craft notes plus exemplars for Telugu and nothing for a language without data", () => {
    const te = refsContext({ language: "Telugu", style: "telugu-folk", brief: "Farmers sowing seed at the first monsoon showers" }, 3, playbookFor("Telugu"));
    expect(te.exemplars).toBe(3);
    expect(te.ids).toHaveLength(3);
    expect(te.text).toMatch(/CRAFT NOTES[\s\S]*QUALITY REFERENCES/);
    expect(refsContext({ language: "Bengali", style: "bengali-folk", brief: "rain" }, 3, playbookFor("Bengali"))).toEqual({ text: "", exemplars: 0, ids: [] });
  });
});

import { parsePointwise, pointwisePrompt } from "../lib/lyrics/harness/pointwise";

describe("pointwise corpus scoring", () => {
  const ids = ["a", "b"];
  it("parses valid entries, drops invalid and unknown ids", () => {
    const txt = JSON.stringify({ scores: [
      { id: "a", prosody: 4, diction: 5, imagery: 3, cultural: 4, originality: 3 },
      { id: "b", prosody: 4, diction: 9, imagery: 3, cultural: 4, originality: 3 },
      { id: "z", prosody: 4, diction: 4, imagery: 3, cultural: 4, originality: 3 },
    ] });
    const m = parsePointwise(`ok ${txt} done`, ids);
    expect([...m.keys()]).toEqual(["a"]);
    expect(m.get("a")!.mean).toBe(3.8);
  });
  it("returns nothing for garbage and numbers each lyric by id in the prompt", () => {
    expect(parsePointwise("no json", ids).size).toBe(0);
    expect(pointwisePrompt([{ id: "a", language: "Telugu", brief: "rain", lyrics: "x" }])).toContain("id=a");
  });
});

describe("full_opus (Studio) arm", () => {
  const input = { language: "Kannada", style: "kannada-folk", brief: "fishermen at dawn", drafts: [] as string[] };
  const mk = (over: Partial<HarnessDeps> = {}) => {
    const calls = { draft: [] as number[], ask: [] as string[], polish: [] as string[] };
    const deps: HarnessDeps = {
      polish: async (a) => { calls.polish.push(a.lyrics); return `polished:${a.lyrics}`; },
      ask: async (x) => { calls.ask.push(x.model); return '{"best":2,"reason":"r"}'; },
      prefers: async () => true,
      draft: async (a) => { calls.draft.push(a.index); return `draft-${a.index}-`.padEnd(30, "x"); },
      ...over,
    };
    return { deps, calls };
  };
  it("writes three Opus drafts, has Opus pick one, and polishes only that one", async () => {
    const { deps, calls } = mk();
    const r = await runHarness(ARMS.full_opus!, input, deps);
    expect(calls.draft.sort()).toEqual([1, 2, 3]);
    expect(calls.ask).toEqual(["claude-opus-5-5"]);
    expect(calls.polish).toHaveLength(1);
    expect(calls.polish[0]).toContain("draft-2-");
    expect(r.lyrics.startsWith("polished:draft-2-")).toBe(true);
    expect(r.trace.join(" ")).toContain("studio drafts: 3/3");
  });
  it("survives failed drafts, skips the pick for a single survivor, and fails loudly with none", async () => {
    let n = 0;
    const one = mk({ draft: async (a) => { if (++n > 1) throw new Error("x"); return `only-${a.index}`.padEnd(30, "y"); } });
    const r = await runHarness(ARMS.full_opus!, input, one.deps);
    expect(one.calls.ask).toEqual([]);
    expect(r.lyrics.startsWith("polished:only-")).toBe(true);
    const none = mk({ draft: async () => { throw new Error("x"); } });
    await expect(runHarness(ARMS.full_opus!, input, none.deps)).rejects.toThrow("no drafts");
  });
  it("is priced above refs_opus by the drafting and pick, and other arms are unchanged", () => {
    expect(estimateArmUsd(ARMS.full_opus!)).toBeGreaterThan(estimateArmUsd(ARMS.refs_opus!));
    expect(estimateArmUsd(ARMS.full_opus!) - estimateArmUsd(ARMS.refs_opus!)).toBeLessThan(0.2);
    expect(ARMS.refs_opus!.draftModel).toBeUndefined();
  });
});
