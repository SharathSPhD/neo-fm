import { describe, expect, it } from "vitest";

import { isMp3, tagMp3 } from "../lib/audio/id3-tag";
import { mp3DurationSeconds } from "../lib/pool/mp3-duration";

/** MPEG1 layer III, 128 kbps, 44.1 kHz: 417-byte frames. */
function frames(n: number): Uint8Array {
  const parts: number[] = [];
  for (let k = 0; k < n; k++) { const f = new Array(417).fill(0); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; parts.push(...f); }
  return Uint8Array.from(parts);
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("tagMp3", () => {
  const p = { site: "https://neo-fm.com" };
  it("prepends an ID3v2.4 tag carrying the AI flag and leaves the audio intact", () => {
    const src = frames(50);
    const out = tagMp3(src, p);
    expect(text(out.subarray(0, 3))).toBe("ID3");
    expect(out[3]).toBe(4);
    expect(text(out)).toContain("AI_GENERATED");
    expect(text(out)).toContain("SynthID");
    expect(mp3DurationSeconds(out)).toBeCloseTo(mp3DurationSeconds(src) ?? -1, 5);
  });
  it("replaces an existing ID3v2 tag instead of stacking", () => {
    const once = tagMp3(frames(50), p);
    const twice = tagMp3(once, p);
    expect(twice.length).toBe(once.length);
  });
  it("leaves non-MP3 bytes (WAV) alone", () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
    expect(isMp3(wav)).toBe(false);
    expect(tagMp3(wav, p)).toBe(wav);
  });
});
