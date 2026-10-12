import { describe, expect, it } from "vitest";
import { allEvalBriefs } from "../lib/eval/briefs-gen";
import { PILOT_BRIEFS } from "../lib/eval/briefs";

describe("eval brief set", () => {
  const all = allEvalBriefs();
  it("has 30 unique briefs for each of the 5 languages and keeps the frozen pilot ids", () => {
    expect(all.length).toBe(150);
    expect(new Set(all.map((b) => b.id)).size).toBe(150);
    for (const l of ["Kannada", "Tamil", "Telugu", "Hindi", "Bengali"]) expect(all.filter((b) => b.language === l).length).toBe(30);
    for (const p of PILOT_BRIEFS) expect(all.find((b) => b.id === p.id)).toEqual(p);
  });
  it("is deterministic", () => {
    expect(allEvalBriefs()).toEqual(all);
  });
});
