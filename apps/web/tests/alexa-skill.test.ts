import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeToken, encodeToken, handleAlexa, type AlexaEnvelope, type AlexaTrack, type NextTrackQuery, type TrackSource } from "../lib/alexa/skill";

const track = (id: string, language = "hi"): AlexaTrack => ({ id, title: `Song ${id}`, language, url: `https://cdn.example/${id}.mp3` });

function fakeSource(ids = ["a", "b", "c"]) {
  const calls: NextTrackQuery[] = [];
  const source: TrackSource = {
    async next(q) {
      calls.push(q);
      const id = ids.find((i) => !q.recentIds.includes(i)) ?? null;
      return id ? track(id, q.language ?? "hi") : null;
    },
    async byId(id) {
      return ids.includes(id) ? track(id) : null;
    },
  };
  return { source, calls };
}

const intent = (name: string, slots?: AlexaEnvelope["request"]["intent"] extends infer I ? (I extends { slots?: infer S } ? S : never) : never, extra: Partial<AlexaEnvelope> = {}): AlexaEnvelope => ({
  request: { type: "IntentRequest", locale: "en-IN", intent: { name, slots } },
  ...extra,
});
const playing = (token: string, offset = 0) => ({ context: { AudioPlayer: { token, offsetInMilliseconds: offset } } });
const directive = (r: Awaited<ReturnType<typeof handleAlexa>>) => r.response.directives?.[0] as { type: string; playBehavior?: string; audioItem?: { stream: { url: string; token: string; expectedPreviousToken?: string; offsetInMilliseconds: number } } };

describe("alexa skill", () => {
  it("launch says the music is AI-made and plays a track", async () => {
    const { source } = fakeSource();
    const r = await handleAlexa({ request: { type: "LaunchRequest", locale: "en-IN" } }, { source });
    expect(r.response.outputSpeech?.text).toMatch(/made by AI/);
    expect(directive(r)).toMatchObject({ type: "AudioPlayer.Play", playBehavior: "REPLACE_ALL" });
    expect(directive(r).audioItem?.stream.url).toBe("https://cdn.example/a.mp3");
    expect(decodeToken(directive(r).audioItem?.stream.token)).toEqual({ language: null, recentIds: ["a"] });
  });

  it("hi-IN launch is spoken in Hindi", async () => {
    const { source } = fakeSource();
    const r = await handleAlexa({ request: { type: "LaunchRequest", locale: "hi-IN" } }, { source });
    expect(r.response.outputSpeech?.text).toContain("एआई");
  });

  it("PlayStationIntent locks the language from the resolved slot id", async () => {
    const { source, calls } = fakeSource();
    const slot = { value: "தமிழ்", resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id: "ta" } }] }] } };
    const r = await handleAlexa(intent("PlayStationIntent", { language: slot }), { source });
    expect(calls[0]?.language).toBe("ta");
    expect(decodeToken(directive(r).audioItem?.stream.token)?.language).toBe("ta");
  });

  it("falls back to the spoken language name, and to the mixed station when unknown", async () => {
    const { source, calls } = fakeSource();
    await handleAlexa(intent("PlayStationIntent", { language: { value: "Kannada" } }), { source });
    await handleAlexa(intent("PlayStationIntent", { language: { value: "klingon" } }), { source });
    expect(calls.map((c) => c.language)).toEqual(["kn", null]);
  });

  it("PlaybackNearlyFinished enqueues the next track against the current token", async () => {
    const { source } = fakeSource();
    const token = encodeToken({ language: "hi", recentIds: ["a"] });
    const r = await handleAlexa({ request: { type: "AudioPlayer.PlaybackNearlyFinished", token } }, { source });
    expect(directive(r)).toMatchObject({ type: "AudioPlayer.Play", playBehavior: "ENQUEUE" });
    expect(directive(r).audioItem?.stream.expectedPreviousToken).toBe(token);
    expect(directive(r).audioItem?.stream.url).toContain("/b.mp3");
    // Alexa rejects speech on AudioPlayer requests.
    expect(r.response.outputSpeech).toBeUndefined();
  });

  it("PlaybackNearlyFinished with an unknown token does nothing", async () => {
    const { source } = fakeSource();
    const r = await handleAlexa({ request: { type: "AudioPlayer.PlaybackNearlyFinished", token: "garbage" } }, { source });
    expect(r.response).toEqual({});
  });

  it("next skips ahead without repeating the recent tracks", async () => {
    const { source } = fakeSource();
    const r = await handleAlexa(intent("AMAZON.NextIntent", undefined, playing(encodeToken({ language: "hi", recentIds: ["a"] }))), { source });
    expect(directive(r).audioItem?.stream.url).toContain("/b.mp3");
    expect(decodeToken(directive(r).audioItem?.stream.token)?.recentIds).toEqual(["a", "b"]);
  });

  it("'more like this' seeds from the track now playing; calmer/livelier steer energy", async () => {
    const { source, calls } = fakeSource();
    const ctx = playing(encodeToken({ language: null, recentIds: ["a"] }));
    await handleAlexa(intent("LikeIntent", undefined, ctx), { source });
    await handleAlexa(intent("CalmerIntent", undefined, ctx), { source });
    await handleAlexa(intent("LivelierIntent", undefined, ctx), { source });
    expect(calls.map((c) => [c.moreLike, c.energy])).toEqual([["a", undefined], [undefined, "down"], [undefined, "up"]]);
  });

  it("pause, stop and cancel stop playback; resume continues the same track from its offset", async () => {
    const { source } = fakeSource();
    for (const n of ["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]) {
      expect(directive(await handleAlexa(intent(n), { source })).type).toBe("AudioPlayer.Stop");
    }
    const token = encodeToken({ language: "hi", recentIds: ["a", "b"] });
    const r = await handleAlexa(intent("AMAZON.ResumeIntent", undefined, playing(token, 42_000)), { source });
    expect(directive(r).audioItem?.stream).toMatchObject({ offsetInMilliseconds: 42_000 });
    expect(directive(r).audioItem?.stream.url).toContain("/b.mp3");
    expect(decodeToken(directive(r).audioItem?.stream.token)?.recentIds).toEqual(["a", "b"]);
  });

  it("a failed stream moves on to another track instead of ending the station", async () => {
    const { source } = fakeSource();
    const token = encodeToken({ language: "hi", recentIds: ["a"] });
    const r = await handleAlexa({ request: { type: "AudioPlayer.PlaybackFailed", token } }, { source });
    expect(directive(r).audioItem?.stream.url).toContain("/b.mp3");
  });

  it("an empty pool says so instead of failing", async () => {
    const { source } = fakeSource([]);
    const r = await handleAlexa({ request: { type: "LaunchRequest", locale: "en-IN" } }, { source });
    expect(r.response.directives).toBeUndefined();
    expect(r.response.outputSpeech?.text).toMatch(/quiet/);
  });

  it("lifecycle events and unsupported intents get a safe answer", async () => {
    const { source } = fakeSource();
    for (const type of ["AudioPlayer.PlaybackStarted", "AudioPlayer.PlaybackStopped", "AudioPlayer.PlaybackFinished", "SessionEndedRequest", "System.ExceptionEncountered"]) {
      expect((await handleAlexa({ request: { type } }, { source })).response).toEqual({});
    }
    expect((await handleAlexa(intent("AMAZON.ShuffleOnIntent"), { source })).response.directives).toBeUndefined();
    expect((await handleAlexa(intent("AMAZON.PreviousIntent"), { source })).response.outputSpeech?.text).toMatch(/forward/);
  });

  it("en-GB launch is spoken in English", async () => {
    const { source } = fakeSource();
    const r = await handleAlexa({ request: { type: "LaunchRequest", locale: "en-GB" } }, { source });
    expect(r.response.outputSpeech?.text).toMatch(/made by AI/);
  });

  it("tokens stay under Alexa's 1024-character limit with UUID ids", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `${"0".repeat(8)}-0000-0000-0000-${String(i).padStart(12, "0")}`);
    expect(encodeToken({ language: "hi", recentIds: ids }).length).toBeLessThan(1024);
  });
});

describe("alexa skill package", () => {
  const dir = resolve(__dirname, "../../../alexa/skill-package");
  const load = (p: string) => JSON.parse(readFileSync(resolve(dir, p), "utf8"));

  for (const locale of ["en-IN", "en-GB", "hi-IN"]) {
    it(`${locale} model has the required playback intents and only slots it declares`, () => {
      const lm = load(`interactionModels/custom/${locale}.json`).interactionModel.languageModel;
      const names = lm.intents.map((i: { name: string }) => i.name);
      expect(names).toEqual(expect.arrayContaining(["AMAZON.PauseIntent", "AMAZON.ResumeIntent", "AMAZON.NextIntent", "PlayStationIntent", "LikeIntent"]));
      for (const intent of lm.intents as { slots?: { name: string }[]; samples: string[] }[]) {
        const declared = new Set((intent.slots ?? []).map((s) => s.name));
        for (const sample of intent.samples) for (const m of sample.matchAll(/\{(\w+)\}/g)) expect(declared.has(m[1]!)).toBe(true);
      }
      // ASK rejects custom samples on AMAZON.NextIntent ("cannot be extended"); Alexa's built-in phrases cover next/skip.
      expect(lm.intents.find((i: { name: string }) => i.name === "AMAZON.NextIntent").samples).toEqual([]);
      const codes = lm.types[0].values.map((v: { id: string }) => v.id);
      expect(codes).toEqual(["hi", "ta", "te", "kn", "bn", "en"]);
    });
  }

  it("manifest enables AudioPlayer, is limited to India and the UK and carries no ads or purchases", () => {
    const m = load("skill.json").manifest;
    expect(m.apis.custom.interfaces).toEqual([{ type: "AUDIO_PLAYER" }]);
    expect(m.publishingInformation.distributionCountries).toEqual(["IN", "GB"]);
    expect(m.privacyAndCompliance).toMatchObject({ allowsPurchases: false, containsAds: false });
  });

  it("store copy stays inside Alexa's limits and names the AI label", () => {
    const locales = load("skill.json").manifest.publishingInformation.locales as Record<string, { name: string; summary: string; description: string; examplePhrases: string[] }>;
    for (const [locale, l] of Object.entries(locales)) {
      expect(l.summary.length, `${locale} summary`).toBeLessThanOrEqual(160);
      expect(l.description.length, `${locale} description`).toBeLessThanOrEqual(4000);
      expect(l.examplePhrases.length, locale).toBeGreaterThanOrEqual(2);
      expect(l.description, locale).toMatch(/AI|एआई/);
    }
  });

  it("invocation names are lowercase words or Devanagari with no launch phrases", () => {
    for (const locale of ["en-IN", "en-GB", "hi-IN"]) {
      const name = load(`interactionModels/custom/${locale}.json`).interactionModel.languageModel.invocationName as string;
      expect(name).not.toMatch(/\b(alexa|skill|app|open|launch|play)\b/i);
      expect(name).not.toMatch(/[A-Z]/);
    }
  });
});
