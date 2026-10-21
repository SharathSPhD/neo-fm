import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ALMANAC_DAYS, ALMANAC_LANGS, FESTIVALS, allAlmanacLines, almanacIdsFor, almanacLines, almanacText, countdownsOn } from "../lib/station/almanac";
import { PROGRAMME_EVERY, chooseLine, type VoiceContext, type VoiceLine } from "../lib/station/voice-links";

describe("almanac countdowns", () => {
  it("count days to Diwali (8 Nov 2026) only inside the announced window", () => {
    expect(countdownsOn(2026, 11, 8)).toContainEqual({ festival: "diwali", days: 0 });
    expect(countdownsOn(2026, 11, 6)).toContainEqual({ festival: "diwali", days: 2 });
    expect(countdownsOn(2026, 11, 5).some((c) => c.festival === "diwali")).toBe(true); // three days out
    expect(countdownsOn(2026, 11, 4).some((c) => c.festival === "diwali")).toBe(false);
    expect(countdownsOn(2026, 11, 9).some((c) => c.festival === "diwali")).toBe(false);
  });

  it("lists the nearest festival first and handles the year boundary", () => {
    const c = countdownsOn(2026, 12, 31);
    expect(c).toEqual([{ festival: "new-year", days: 1 }]);
    expect(countdownsOn(2026, 11, 6).map((x) => x.festival)).toEqual(["dhanteras", "diwali"]);
  });

  it("writes templated text with the festival name in every language and no leftover placeholders", () => {
    for (const f of FESTIVALS) for (const days of ALMANAC_DAYS) for (const lang of ALMANAC_LANGS) {
      const t = almanacText(f, days, lang);
      expect(t).toContain(f.name[lang]);
      expect(t).not.toMatch(/\$\{|undefined/);
      expect(t.length).toBeLessThan(160);
    }
    expect(almanacText(FESTIVALS[1]!, 2, "en")).toBe("Just two days to Diwali. The festive music keeps playing on neo-fm.");
  });

  it("is off unless the flag is on, and silent until audio has been rendered", () => {
    expect(almanacIdsFor(2026, 11, 8, false)).toEqual([]);
    expect(almanacLines(false)).toEqual([]);
    expect(almanacIdsFor(2026, 11, 8, true).every((id) => allAlmanacLines().some((l) => l.id === id))).toBe(true);
  });

  it("ships an audio file for every rendered line", () => {
    for (const l of almanacLines(true)) expect(existsSync(join(__dirname, "../public/voice", `${l.id}.mp3`))).toBe(true);
  });
});

describe("feature slot", () => {
  const line = (o: Partial<VoiceLine> & { id: string }): VoiceLine => ({ kind: "host-link", lang: "hi", daypart: "evening", seconds: 10, text: "t", ...o });
  const LINES = [
    line({ id: "host-link/hi-evening-1" }),
    line({ id: "programme/hi-evening-raga", kind: "programme" }),
    line({ id: "almanac/diwali-d0-hi", kind: "almanac", daypart: undefined }),
  ];
  const ctx = (breaks: number, almanacIds?: string[], seen: string[] = []): VoiceContext => ({
    hour: 17, language: null, almanacIds, state: { played: 9, since: 9, breaks, seen, lastCheckHour: null },
  });
  const slot = PROGRAMME_EVERY - 1;

  it("alternates almanac and programme across feature slots", () => {
    const ids = ["almanac/diwali-d0-hi"];
    expect(chooseLine(LINES, ctx(slot, ids), "hi", () => 0)?.kind).toBe("almanac");
    expect(chooseLine(LINES, ctx(slot + PROGRAMME_EVERY, ids), "hi", () => 0)?.kind).toBe("programme");
  });

  it("gives way to the programme when there is no countdown today or it was already heard", () => {
    expect(chooseLine(LINES, ctx(slot), "hi", () => 0)?.kind).toBe("programme");
    expect(chooseLine(LINES, ctx(slot, ["almanac/diwali-d0-hi"], ["almanac/diwali-d0-hi"]), "hi", () => 0)?.kind).toBe("programme");
  });

  it("never plays an almanac line outside a feature slot", () => {
    expect(chooseLine(LINES, ctx(0, ["almanac/diwali-d0-hi"]), "hi", () => 0)?.kind).not.toBe("almanac");
  });
});
