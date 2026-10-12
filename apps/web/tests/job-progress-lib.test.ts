import { describe, expect, it } from "vitest";
import { deriveStage, etaFromHistory, formatDuration } from "../lib/progress/job-progress";

const run = (o: Partial<Parameters<typeof deriveStage>[0] & object> = {}) => ({ session_id: null, lyria_calls: 0, audio_path: null, polished_lyrics: null, ...o });

describe("deriveStage", () => {
  it("walks the pipeline in order", () => {
    expect(deriveStage(undefined)).toBe("starting");
    expect(deriveStage(run())).toBe("starting");
    expect(deriveStage(run({ session_id: "s" }))).toBe("writing");
    expect(deriveStage(run({ session_id: "s", lyria_calls: 1 }))).toBe("polishing");
    expect(deriveStage(run({ session_id: "s", lyria_calls: 1, polished_lyrics: "x" }))).toBe("singing");
    expect(deriveStage(run({ session_id: "s", lyria_calls: 1, polished_lyrics: "x", audio_path: "a/1.mp3" }))).toBe("finishing");
  });
});

describe("etaFromHistory", () => {
  it("returns null with too little history", () => {
    expect(etaFromHistory([100000, 200000])).toBeNull();
  });
  it("computes p50/p90 in seconds and ignores junk", () => {
    const e = etaFromHistory([100000, 200000, 300000, 400000, 500000, null, "x", -5, 0]);
    expect(e).toEqual({ n: 5, p50_s: 300, p90_s: 460 });
  });
});

describe("formatDuration", () => {
  it("uses seconds under 90 s and minutes above", () => {
    expect(formatDuration(42)).toBe("40 seconds");
    expect(formatDuration(5)).toBe("10 seconds");
    expect(formatDuration(480)).toBe("8 min");
  });
});
