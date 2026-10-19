import { describe, expect, it } from "vitest";

import { takeFallback } from "../lib/station/fallback";
import { renderedProgrammes } from "../lib/station/programmes";
import { voiceItem, VOICE_LINES } from "../lib/station/voice-links";

describe("takeFallback", () => {
  it("returns the static fallback once per item, even though the CDN URL ends with the same path", () => {
    const item = voiceItem(VOICE_LINES[0]!, "n1", "https://pub-x.r2.dev");
    // The regression: the CDN URL ends with the relative fallback, so an endsWith check skipped the retry.
    expect(item.url.endsWith(item.fallbackUrl!)).toBe(true);
    const tried = new Set<string>();
    expect(takeFallback(item, tried)).toBe(item.fallbackUrl);
    expect(takeFallback(item, tried)).toBeNull();
  });
  it("tracks items separately and ignores items without a fallback", () => {
    const tried = new Set<string>();
    expect(takeFallback({ id: "a", fallbackUrl: "/voice/a.mp3" }, tried)).toBe("/voice/a.mp3");
    expect(takeFallback({ id: "b", fallbackUrl: "/voice/b.mp3" }, tried)).toBe("/voice/b.mp3");
    expect(takeFallback({ id: "c" }, tried)).toBeNull();
    expect(takeFallback(null, tried)).toBeNull();
  });
});

describe("renderedProgrammes", () => {
  it("lists programme ids under voice/programme/ for the mirror", () => {
    const ids = renderedProgrammes().map((l) => l.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("programme/"))).toBe(true);
  });
});
