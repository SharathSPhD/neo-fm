import { describe, expect, it } from "vitest";

import { tagShareUrl } from "../lib/share/tag";
import { TOGETHER_MAX_AGE_MS, togetherOffset, togetherUrl } from "../lib/station/together";

const ID = "1ad50c06-9f3b-46b6-984a-44885fb771b8";
const NOW = 1_792_500_000_000;

describe("togetherUrl", () => {
  it("is the track page with the playhead and send time", () => {
    const u = new URL(togetherUrl(ID, 41.9, NOW, "https://x.test/"));
    expect(u.pathname).toBe(`/t/${ID}`);
    expect(u.searchParams.get("at")).toBe("41");
    expect(u.searchParams.get("ts")).toBe(String(NOW));
  });
  it("keeps the playhead through the share tags and never goes negative", () => {
    const tagged = new URL(tagShareUrl(togetherUrl(ID, -5, NOW, "https://x.test"), { source: "whatsapp", campaign: "together" }));
    expect(tagged.searchParams.get("at")).toBe("0");
    expect(tagged.searchParams.get("utm_campaign")).toBe("together");
    expect(tagged.searchParams.get("utm_source")).toBe("whatsapp");
  });
});

describe("togetherOffset", () => {
  const link = (at: number, ts: number) => new URL(togetherUrl(ID, at, ts, "https://x.test")).search;

  it("adds the time since the link was sent to the sender's playhead", () => {
    expect(togetherOffset(link(40, NOW - 12_000), NOW, 180)).toBe(52);
    expect(togetherOffset(link(40, NOW), NOW, 180)).toBe(40);
  });
  it("is null for a plain track link or a malformed one", () => {
    expect(togetherOffset("", NOW)).toBeNull();
    expect(togetherOffset("?at=40", NOW)).toBeNull();
    expect(togetherOffset("?at=abc&ts=1792500000000", NOW)).toBeNull();
    expect(togetherOffset("?at=40&ts=12", NOW)).toBeNull();
  });
  it("expires after the window and rejects a send time far in the future", () => {
    expect(togetherOffset(link(10, NOW - TOGETHER_MAX_AGE_MS - 1), NOW, 600)).toBeNull();
    expect(togetherOffset(link(10, NOW - TOGETHER_MAX_AGE_MS), NOW, 3000)).not.toBeNull();
    expect(togetherOffset(link(10, NOW + 10 * 60_000), NOW)).toBeNull();
  });
  it("tolerates small clock skew and falls back when the song is nearly over", () => {
    expect(togetherOffset(link(10, NOW + 30_000), NOW)).toBe(10);
    expect(togetherOffset(link(170, NOW - 5_000), NOW, 175)).toBeNull();
    expect(togetherOffset(link(170, NOW - 5_000), NOW, 200)).toBe(175);
  });
});
