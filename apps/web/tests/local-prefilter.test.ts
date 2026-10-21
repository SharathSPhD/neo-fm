import { describe, expect, it } from "vitest";
import { localPrefilter, localPrefilterEnabled, scoreLocal } from "../lib/diction/local-prefilter";
import { curateTrack } from "../lib/pool/curation";
import { summarizeQuality } from "../lib/ops/quality-monitor";

const on = { DICTION_LOCAL_PREFILTER: "1", LOCAL_ASR_URL: "https://asr.example.com/" } as unknown as NodeJS.ProcessEnv;
const lyrics = "ಬಾನು ತೆರೆದ ಕೈಯಂತೆ ಕರೆಯುತಿದೆ\nಬಾರೋ ಮಳೆರಾಯ ಮನ ಹಗುರಾಗಿದೆ";

describe("local diction pre-filter", () => {
  it("is off without the flag, the url or a kn/hi language", () => {
    expect(localPrefilterEnabled("kn", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(localPrefilterEnabled("kn", { DICTION_LOCAL_PREFILTER: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(localPrefilterEnabled("ta", on)).toBe(false);
    expect(localPrefilterEnabled("kn", on)).toBe(true);
  });
  it("scores a transcript with the production gate", () => {
    expect(scoreLocal(lyrics, lyrics).lowLikely).toBe(false);
    expect(scoreLocal(lyrics, "").lowLikely).toBe(true);
  });
  it("returns null when disabled, on http errors and on thrown fetches", async () => {
    const a = { lyrics, language: "kn", audioUrl: "https://x/y.mp3" };
    expect(await localPrefilter(a, { env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(await localPrefilter(a, { env: on, fetchImpl: (async () => new Response("no", { status: 500 })) as typeof fetch })).toBeNull();
    expect(await localPrefilter(a, { env: on, fetchImpl: (async () => { throw new Error("down"); }) as typeof fetch })).toBeNull();
  });
  it("scores the service transcript", async () => {
    const r = await localPrefilter({ lyrics, language: "kn", audioUrl: "https://x/y.mp3" }, { env: on, fetchImpl: (async () => Response.json({ transcript: lyrics })) as typeof fetch });
    expect(r?.source).toBe("local-asr");
    expect(r!.unorderedPct).toBeGreaterThan(90);
  });
  it("flags an unscored lake track watch, never replace, and ignores local when Gemini scored it", () => {
    const base = { id: "t", title: null, language: "kn", genre: null, energy: null, judge_overall: 4, duration_seconds: 90 };
    expect(curateTrack({ ...base, diction_u: null, local_diction_u: 30 }).flags).toContain("local-low");
    expect(curateTrack({ ...base, diction_u: null, local_diction_u: 30 }).verdict).not.toBe("replace");
    expect(curateTrack({ ...base, diction_u: 95, local_diction_u: 30 }).flags).not.toContain("local-low");
  });
  it("averages the local column in the quality monitor", () => {
    const row = (localPct: number | null) => ({ day: "2026-10-21", language: "kn", quality: null, lyrics: null, matchPct: null, unorderedPct: null, verdict: null, localPct });
    const g = summarizeQuality([row(40), row(60), row(null)], 14).groups[0]!;
    expect(g.local_n).toBe(2);
    expect(g.avg_local_pct).toBe(50);
  });
});
