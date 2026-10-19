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

describe("spoken segment delivery and disclosure", () => {
  it("serves from the CDN with the static file as fallback when a base is given", () => {
    const it = voiceItem(line({ id: "host-link/hi-morning-1" }), "n", "https://cdn.example.com/");
    expect(it.url).toBe("https://cdn.example.com/voice/host-link/hi-morning-1.mp3");
    expect(it.fallbackUrl).toBe("/voice/host-link/hi-morning-1.mp3");
  });

  it("serves the static file without a base, or with an unsafe one", () => {
    expect(voiceItem(line({ id: "host-link/hi-morning-1" }), "n", undefined).url).toBe("/voice/host-link/hi-morning-1.mp3");
    const http = voiceItem(line({ id: "host-link/hi-morning-1" }), "n", "http://cdn.example.com");
    expect(http.url).toBe("/voice/host-link/hi-morning-1.mp3");
    expect(http.fallbackUrl).toBeUndefined();
  });

  it("marks every rendered segment as AI-made", () => {
    expect(VOICE_LINES.length).toBeGreaterThan(0);
    for (const l of VOICE_LINES) {
      const it = voiceItem(l, "n", undefined);
      expect(it.voice.aiMade).toBe(true);
      expect(it.title).toBe("neo-fm AI host");
    }
  });
});

describe("rendered launch-language segments", () => {
  it("has idents and host links for every launch language and none rejected", () => {
    for (const lang of ["hi", "ta", "te", "kn", "mr"]) {
      for (const kind of ["ident-daypart", "host-link"] as const) {
        expect(VOICE_LINES.some((l) => l.lang === lang && l.kind === kind), `${lang} ${kind}`).toBe(true);
      }
    }
    expect(VOICE_LINES.some((l) => l.id === "ident-daypart/te-evening-2")).toBe(false);
  });
});

describe("variety for fresh sessions", () => {
  it("does not play only idents on a listener's first break", () => {
    const real = VOICE_LINES.filter((l) => l.lang === "hi");
    let n = 0;
    const rand = () => { n = (n * 7 + 3) % 101; return n / 101; };
    const kinds = new Set<string>();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = pickVoice(real, queue(6), ctx({ state: state({ played: 0, since: 0, breaks: 0 }) }), rand);
      if (p) { kinds.add(p.line.kind); ids.add(p.line.id); }
    }
    expect(kinds.has("host-link")).toBe(true);
    expect(kinds.has("ident-daypart")).toBe(true);
    expect(ids.size).toBeGreaterThan(3);
  });
});
