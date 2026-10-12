import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PCE_EVAL } from "../lib/eval/pce-results";

const doc = readFileSync(resolve(__dirname, "../../../managed-agents/EVAL-PCE.md"), "utf8");

describe("public PCE evidence", () => {
  it("per-language wins add up to the headline Claude-judge totals", () => {
    const pce = PCE_EVAL.byLanguage.reduce((n, r) => n + r.pceWins, 0);
    const base = PCE_EVAL.byLanguage.reduce((n, r) => n + r.baselineWins, 0);
    expect(pce).toBe(PCE_EVAL.judges.claude.pce);
    expect(base).toBe(PCE_EVAL.judges.claude.baseline);
    expect(pce + base + PCE_EVAL.ties).toBe(PCE_EVAL.pairs);
  });

  it("matches managed-agents/EVAL-PCE.md", () => {
    const { claude, gemini } = PCE_EVAL.judges;
    expect(doc).toContain(`| **${claude.pce}** | ${claude.baseline} | ${PCE_EVAL.ties} |`);
    expect(doc).toContain(`${gemini.pce}** / ${gemini.baseline}`);
    expect(doc).toContain(`n=${PCE_EVAL.pairs}`);
    for (const r of PCE_EVAL.byLanguage) {
      expect(doc).toContain(`${r.language} ${r.pceWins}-${r.baselineWins}`);
    }
    expect(doc).toContain(`Gemini splits Kannada ${PCE_EVAL.kannadaGemini.pce}-${PCE_EVAL.kannadaGemini.baseline}`);
    for (const d of PCE_EVAL.dimensions) {
      const v = `${d.diff < 0 ? "-" : "+"}${Math.abs(d.diff).toFixed(2)}`;
      expect(doc.toLowerCase()).toContain(`${d.label.toLowerCase().replace("cultural fit", "cultural")} ${v}`);
    }
  });

  it("states prosody is behind", () => {
    expect(PCE_EVAL.dimensions.find((d) => d.label === "Prosody")!.diff).toBeLessThan(0);
  });
});
