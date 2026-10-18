import { describe, expect, it } from "vitest";

import { mp3DurationSeconds } from "../lib/pool/mp3-duration";
import { deriveEnergyDaypart } from "../lib/pool/tags";

/** MPEG1 layer III, 128 kbps, 44.1 kHz: 417-byte frames of 1152 samples. */
function frames(n: number, id3 = false): Uint8Array {
  const parts: number[] = id3 ? [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4] : [];
  for (let k = 0; k < n; k++) { const f = new Array(417).fill(0); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0; parts.push(...f); }
  return Uint8Array.from(parts);
}

describe("mp3DurationSeconds", () => {
  it("sums frame durations", () => {
    expect(mp3DurationSeconds(frames(100))).toBeCloseTo((100 * 1152) / 44100, 3);
  });
  it("skips an ID3v2 tag", () => {
    expect(mp3DurationSeconds(frames(100, true))).toBeCloseTo((100 * 1152) / 44100, 3);
  });
  it("returns null for non-mp3 bytes", () => {
    expect(mp3DurationSeconds(new Uint8Array(5000))).toBeNull();
  });
});

describe("deriveEnergyDaypart", () => {
  it("tags a fast festive track high and morning", () => {
    expect(deriveEnergyDaypart({ mood: ["festive", "energetic"], theme: [], genre: "garba", tempo_bpm: 136 })).toEqual({ energy: "high", daypart: ["morning"] });
  });
  it("tags a calm devotional track low, dawn and dusk", () => {
    expect(deriveEnergyDaypart({ mood: ["devotional", "calm"], theme: ["bhakti"], genre: "bhajan", tempo_bpm: 80 })).toEqual({ energy: "low", daypart: ["dawn", "dusk", "night"] });
  });
  it("never returns an empty daypart", () => {
    expect(deriveEnergyDaypart({ mood: [], theme: [], genre: null, tempo_bpm: null }).daypart).toEqual(["evening"]);
  });
});
