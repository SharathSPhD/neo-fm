import { describe, expect, it } from "vitest";

import { programmeLines } from "../lib/station/programmes";
import { PROGRAMME_EVERY, chooseLine, type VoiceContext, type VoiceLine } from "../lib/station/voice-links";

const line = (o: Partial<VoiceLine> & { id: string }): VoiceLine => ({ kind: "host-link", lang: "hi", daypart: "evening", seconds: 10, text: "t", ...o });
const LINES = [line({ id: "host-link/hi-evening-1" }), line({ id: "programme/hi-evening-raga", kind: "programme", seconds: 30 })];
const ctx = (breaks: number): VoiceContext => ({ hour: 17, language: null, state: { played: 9, since: 9, breaks, seen: [], lastCheckHour: null } });

describe("programmes", () => {
  it("are off unless the flag is on", () => {
    expect(programmeLines(false)).toEqual([]);
  });

  it("only offers lines whose audio has been rendered", () => {
    expect(programmeLines(true).every((l) => l.kind === "programme" && l.seconds > 0)).toBe(true);
    expect(programmeLines(true)).toEqual([]); // nothing rendered yet
  });

  it("take every Nth break, other breaks stay host links", () => {
    expect(chooseLine(LINES, ctx(PROGRAMME_EVERY - 1), "hi", () => 0)?.kind).toBe("programme");
    expect(chooseLine(LINES, ctx(PROGRAMME_EVERY), "hi", () => 0)?.kind).toBe("host-link");
  });

  it("fall back to a host link when no programme matches the daypart or language", () => {
    expect(chooseLine(LINES, ctx(PROGRAMME_EVERY - 1), "ta", () => 0)).toBeNull();
    const only = [LINES[0]!];
    expect(chooseLine(only, ctx(PROGRAMME_EVERY - 1), "hi", () => 0)?.kind).toBe("host-link");
  });
});
