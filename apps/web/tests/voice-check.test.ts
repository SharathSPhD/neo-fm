import { describe, expect, it, vi } from "vitest";

import { genderMissed, renderWithVoiceCheck, type HeardGender } from "../lib/voice/check";

const audio = (n: number) => ({ audio: new Uint8Array([n]), mimeType: "audio/mpeg" });

describe("genderMissed", () => {
  it("flags a clearly different voice, not an unclear one", () => {
    expect(genderMissed("male", "female")).toBe(true);
    expect(genderMissed("male", "mixed")).toBe(true);
    expect(genderMissed("female", "female")).toBe(false);
    expect(genderMissed("male", "unclear")).toBe(false);
    expect(genderMissed("duet", "male")).toBe(true);
    expect(genderMissed("duet", "mixed")).toBe(false);
    expect(genderMissed("station", "female")).toBe(false);
  });
});

describe("renderWithVoiceCheck", () => {
  it("never checks or retries the station mix", async () => {
    const render = vi.fn(async () => audio(1));
    const check = vi.fn(async (): Promise<HeardGender> => "female");
    const out = await renderWithVoiceCheck("station", render, check);
    expect(out.retried).toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("keeps the first render on a hit", async () => {
    const render = vi.fn(async () => audio(1));
    const out = await renderWithVoiceCheck("female", render, async () => "female");
    expect(out.result.audio[0]).toBe(1);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("re-renders once on a miss and keeps the retry", async () => {
    let n = 0;
    const render = vi.fn(async () => audio(++n));
    const out = await renderWithVoiceCheck("male", render, async () => "female");
    expect(out).toMatchObject({ missed: true, retried: true });
    expect(out.result.audio[0]).toBe(2);
    expect(render).toHaveBeenCalledTimes(2);
  });
  it("falls back to the first render when the retry fails or the check throws", async () => {
    let n = 0;
    const failing = vi.fn(async () => { if (++n > 1) throw new Error("cap"); return audio(1); });
    expect((await renderWithVoiceCheck("male", failing, async () => "female")).result.audio[0]).toBe(1);
    const render = vi.fn(async () => audio(1));
    const out = await renderWithVoiceCheck("male", render, async () => { throw new Error("down"); });
    expect(out).toMatchObject({ missed: false, retried: false });
    expect(render).toHaveBeenCalledTimes(1);
  });
});
