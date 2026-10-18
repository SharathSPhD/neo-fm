import { describe, expect, it } from "vitest";

import { VOICE_LINES, chooseLine, parseVoiceState, pickVoice, voiceItem, type VoiceClientState, type VoiceContext, type VoiceLine } from "../lib/station/voice-links";

const line = (o: Partial<VoiceLine> & { id: string }): VoiceLine => ({ kind: "host-link", lang: "hi", daypart: "morning", seconds: 10, text: "t", ...o });
const LINES: VoiceLine[] = [
  line({ id: "ident-daypart/hi-morning-1", kind: "ident-daypart" }),
  line({ id: "host-link/hi-morning-1" }),
  line({ id: "host-link/hi-morning-2" }),
  line({ id: "ident-station/hi-1", kind: "ident-station", daypart: undefined }),
  line({ id: "time-check/hi-10", kind: "time-check", daypart: undefined, hour: 10 }),
  line({ id: "host-link/ta-morning-1", lang: "ta" }),
];
const state = (o: Partial<VoiceClientState> = {}): VoiceClientState => ({ played: 5, since: 5, breaks: 0, seen: [], lastCheckHour: null, ...o });
const ctx = (o: Partial<VoiceContext> = {}): VoiceContext => ({ hour: 10, language: null, state: state(), ...o });
const vocal = (language = "hi", extra: object = {}) => ({ language, ...extra });
const queue = (n: number, language = "hi") => Array.from({ length: n }, () => vocal(language));

describe("pickVoice cadence", () => {
  it("never opens the station: nothing before the first track even when the session is brand new", () => {
    const p = pickVoice(LINES, queue(6), ctx({ state: state({ played: 0, since: 0 }) }), () => 0);
    expect(p?.index).toBe(2);
  });

  it("waits for three tracks since the last break, counting the tracks already played", () => {
    expect(pickVoice(LINES, queue(6), ctx({ state: state({ since: 0, breaks: 2 }) }), () => 0)?.index).toBe(3);
    expect(pickVoice(LINES, queue(6), ctx({ state: state({ since: 2, breaks: 2 }) }), () => 0)?.index).toBe(1);
    expect(pickVoice(LINES, queue(6), ctx({ state: state({ since: 9, breaks: 2 }) }), () => 0)?.index).toBe(0);
  });

  it("returns null when the slice is too short for the cadence", () => {
    expect(pickVoice(LINES, queue(2), ctx({ state: state({ since: 0, breaks: 2 }) }), () => 0)).toBeNull();
  });

  it("does nothing without lines", () => {
    expect(pickVoice([], queue(6), ctx(), () => 0)).toBeNull();
  });
});

describe("pickVoice placement", () => {
  it("never splits a crossfaded set", () => {
    const items = [vocal(), vocal(), vocal("hi", { joinedToPrev: true }), vocal("hi", { joinedToPrev: true }), vocal()];
    expect(pickVoice(LINES, items, ctx({ state: state({ since: 0, breaks: 2 }) }), () => 0)?.index).toBe(4);
  });

  it("keeps clear of an ad: not at the ad and not straight after it", () => {
    const items = [vocal(), vocal(), { language: "", type: "ad" as const }, vocal(), vocal(), vocal()];
    const p = pickVoice(LINES, items, ctx({ state: state({ since: 0, breaks: 2 }) }), () => 0);
    expect(p?.index).toBe(4);
  });

  it("speaks the language of the track it introduces and skips instrumentals on the open station", () => {
    const items = [vocal("ta"), vocal("ta"), { language: "zxx", kind: "instrumental" as const }, vocal("ta"), vocal("hi")];
    const p = pickVoice(LINES, items, ctx({ state: state({ since: 1, breaks: 2 }) }), () => 0);
    expect(p?.index).toBe(2 + 1);
    expect(p?.line.lang).toBe("ta");
  });

  it("uses the locked language even before an instrumental", () => {
    const items = [vocal(), vocal(), { language: "zxx", kind: "instrumental" as const }, vocal()];
    const p = pickVoice(LINES, items, ctx({ language: "hi", state: state({ since: 1, breaks: 2 }) }), () => 0);
    expect(p?.index).toBe(2);
    expect(p?.line.lang).toBe("hi");
  });

  it("skips a language with no rendered lines instead of speaking the wrong one", () => {
    expect(pickVoice(LINES, queue(6, "kn"), ctx(), () => 0)).toBeNull();
  });
});

describe("chooseLine", () => {
  it("greets first, then rotates links and a station ident every fourth break", () => {
    const kinds = [0, 1, 2, 3].map((breaks) => chooseLine(LINES, ctx({ state: state({ breaks }) }), "hi", () => 0)?.kind);
    expect(kinds).toEqual(["ident-daypart", "host-link", "host-link", "ident-station"]);
  });

  it("matches the daypart: no morning greeting at night", () => {
    expect(chooseLine(LINES, ctx({ hour: 23 }), "hi", () => 0)).toBeNull();
  });

  it("does not repeat a line heard this session and falls back to another kind", () => {
    const seen = ["host-link/hi-morning-1", "host-link/hi-morning-2"];
    expect(chooseLine(LINES, ctx({ state: state({ breaks: 1, seen }) }), "hi", () => 0)?.kind).toBe("ident-daypart");
  });

  it("adds time checks only when enabled, only once per hour, and never as the first break", () => {
    const on = (o: Partial<VoiceClientState>) => chooseLine(LINES, ctx({ timeChecks: true, state: state({ breaks: 1, ...o }) }), "hi", () => 0)?.kind;
    expect(on({})).toBe("time-check");
    expect(on({ lastCheckHour: 10 })).toBe("host-link");
    expect(on({ breaks: 0 })).toBe("ident-daypart");
    expect(chooseLine(LINES, ctx({ state: state({ breaks: 1 }) }), "hi", () => 0)?.kind).toBe("host-link");
  });
});

describe("parseVoiceState and voiceItem", () => {
  it("falls back to the played counter when no break has happened and drops unknown ids", () => {
    const known = VOICE_LINES[0]!.id;
    const s = parseVoiceState(new URLSearchParams(`played=4&vn=2&vseen=${known},nope&vhr=9`));
    expect(s).toEqual({ played: 4, since: 4, breaks: 2, seen: [known], lastCheckHour: 9 });
    expect(parseVoiceState(new URLSearchParams("vsince=-3&vn=abc"))).toMatchObject({ since: 0, breaks: 0, lastCheckHour: null });
  });

  it("builds an AI-labelled item that points at a shipped static file", () => {
    const l = VOICE_LINES[0]!;
    const item = voiceItem(l, "abc");
    expect(item).toMatchObject({ type: "voice", url: `/voice/${l.id}.mp3`, voice: { lineId: l.id, aiMade: true } });
  });

  it("ships every indexed line as an mp3 under public/voice", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const l of VOICE_LINES) expect(existsSync(join(__dirname, "../public/voice", `${l.id}.mp3`)), l.id).toBe(true);
  });
});
