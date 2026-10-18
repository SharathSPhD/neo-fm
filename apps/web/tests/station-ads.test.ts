import { describe, expect, it } from "vitest";

import { AD_CAPS, adLabel, eligibleSlots, pickAd, placeAd, tracksBeforeBreak, weightedPick, type AdContext, type AdSlot } from "../lib/station/ads";
import { parseAdState } from "../lib/station/ads-server";
import { summarizeAds } from "../lib/ops/ads-report";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const slot = (o: Partial<AdSlot> = {}): AdSlot => ({
  id: "s1", kind: "house", sponsorName: null, headline: "Gift a song", ctaLabel: "Gift", ctaUrl: "/gift", audioPath: null, durationSeconds: null,
  languages: [], dayparts: [], excludedTags: [], aiMade: false, weight: 1, startAt: null, endAt: null, active: true, reviewedAt: "2026-11-01T00:00:00Z", ...o,
});
const ctx = (o: Partial<AdContext> = {}): AdContext => ({
  enabled: true, paid: false, language: null, hour: 10, now: NOW, played: 5, sinceBreak: 5, lastBreakAgeMs: null,
  adSecondsLast10Min: 0, adsToday: 0, perCreativeToday: {}, ...o,
});
const tracks = (...tags: string[][]) => tags.map((t) => ({ tags: t }));
const six = tracks(["calm"], ["calm"], ["calm"], ["calm"], ["calm"], ["calm"]);

describe("ad caps", () => {
  it("waits for the first two tracks and five tracks between breaks", () => {
    expect(tracksBeforeBreak({ played: 0, sinceBreak: 0 })).toBe(5);
    expect(tracksBeforeBreak({ played: 3, sinceBreak: 3 })).toBe(2);
    expect(tracksBeforeBreak({ played: 20, sinceBreak: 5 })).toBe(0);
    expect(AD_CAPS.firstBreakAfterTracks).toBe(2);
  });

  it("never puts an ad in the first two tracks of a session", () => {
    // sinceBreak is loose here so only the first-break rule is in play.
    const p = pickAd([slot()], six, ctx({ played: 0, sinceBreak: 5 }), () => 0);
    expect(p?.index).toBe(2);
    const q = pickAd([slot()], six, ctx({ played: 1, sinceBreak: 5 }), () => 0);
    expect(q?.index).toBe(1);
  });

  it("allows one break per five tracks", () => {
    expect(pickAd([slot()], six, ctx({ played: 10, sinceBreak: 1 }), () => 0)?.index).toBe(4);
    expect(pickAd([slot()], six, ctx({ played: 10, sinceBreak: 5 }), () => 0)?.index).toBe(0);
  });

  it("returns nothing when the slice is too short to hold the break; the next refill tries again", () => {
    expect(pickAd([slot()], tracks(["a"], ["b"]), ctx({ played: 10, sinceBreak: 0 }))).toBeNull();
  });

  it("keeps 90 s between breaks", () => {
    expect(pickAd([slot()], six, ctx({ lastBreakAgeMs: 60_000 }))).toBeNull();
    expect(pickAd([slot()], six, ctx({ lastBreakAgeMs: 91_000 }))).not.toBeNull();
  });

  it("caps ad seconds per 10 minutes, per day and per creative", () => {
    expect(pickAd([slot({ durationSeconds: 10 })], six, ctx())).toBeNull(); // a 10 s spot alone exceeds 6 s
    expect(pickAd([slot()], six, ctx({ adSecondsLast10Min: 1 }))).toBeNull(); // card-only counts as 6 s
    expect(pickAd([slot()], six, ctx({ adsToday: AD_CAPS.maxPerDay }))).toBeNull();
    expect(pickAd([slot()], six, ctx({ perCreativeToday: { s1: AD_CAPS.maxPerCreativePerDay } }))).toBeNull();
    expect(pickAd([slot()], six, ctx({ perCreativeToday: { s1: 2 } }))).not.toBeNull();
  });

  it("serves nothing when ads are off or the listener is paid", () => {
    expect(pickAd([slot()], six, ctx({ enabled: false }))).toBeNull();
    expect(pickAd([slot()], six, ctx({ paid: true }))).toBeNull();
  });
});

describe("slot eligibility", () => {
  it("needs an active, reviewed slot inside its date window", () => {
    expect(eligibleSlots([slot({ active: false })], ctx())).toHaveLength(0);
    expect(eligibleSlots([slot({ reviewedAt: null })], ctx())).toHaveLength(0);
    expect(eligibleSlots([slot({ startAt: "2026-11-06T00:00:00Z" })], ctx())).toHaveLength(0);
    expect(eligibleSlots([slot({ endAt: "2026-11-05T09:00:00Z" })], ctx())).toHaveLength(0);
    expect(eligibleSlots([slot({ startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-30T00:00:00Z" })], ctx())).toHaveLength(1);
  });

  it("filters by language for a locked listener but lets neutral spots through", () => {
    const hi = slot({ id: "hi", languages: ["hi"] });
    const any = slot({ id: "any" });
    expect(eligibleSlots([hi, any], ctx({ language: "ta" })).map((s) => s.id)).toEqual(["any"]);
    expect(eligibleSlots([hi, any], ctx({ language: "hi" })).map((s) => s.id)).toEqual(["hi", "any"]);
    expect(eligibleSlots([hi, any], ctx({ language: null })).map((s) => s.id)).toEqual(["hi", "any"]);
  });

  it("filters by daypart and refuses unsafe CTA urls", () => {
    expect(eligibleSlots([slot({ dayparts: ["night"] })], ctx({ hour: 10 }))).toHaveLength(0);
    expect(eligibleSlots([slot({ dayparts: ["night"] })], ctx({ hour: 23 }))).toHaveLength(1);
    expect(eligibleSlots([slot({ ctaUrl: "http://x.example" })], ctx())).toHaveLength(0);
    expect(eligibleSlots([slot({ ctaUrl: "https://x.example" })], ctx())).toHaveLength(1);
  });
});

describe("placement and labels", () => {
  it("never sits next to devotional tracks", () => {
    const t = tracks(["calm"], ["devotional"], ["calm"], ["sad"], ["calm"], ["calm"]);
    // cap allows index 1; 1 is before devotional and 2 is after it, so the first free spot is 3
    expect(placeAd(slot(), t, { played: 1, sinceBreak: 4 })).toBe(3);
  });

  it("never plays directly after a sad or farewell track", () => {
    const t = tracks(["calm"], ["sad"], ["calm"], ["calm"]);
    expect(placeAd(slot(), t, { played: 2, sinceBreak: 3 })).toBe(3);
  });

  it("slides past a slot's own excluded tags", () => {
    const t = tracks(["calm"], ["party"], ["calm"], ["calm"]);
    expect(placeAd(slot({ excludedTags: ["party"] }), t, { played: 10, sinceBreak: 4 })).toBe(3);
  });

  it("labels house spots and names sponsors", () => {
    expect(adLabel({ kind: "house", sponsorName: null })).toBe("From neo-fm");
    expect(adLabel({ kind: "sponsor", sponsorName: "Acme" })).toBe("Sponsored by Acme");
  });

  it("picks by weight", () => {
    const a = { id: "a", weight: 1 };
    const b = { id: "b", weight: 3 };
    expect(weightedPick([a, b], () => 0)?.id).toBe("a");
    expect(weightedPick([a, b], () => 0.5)?.id).toBe("b");
    expect(weightedPick([], () => 0)).toBeNull();
  });
});

describe("client state and report", () => {
  it("parses session counters defensively", () => {
    const s = parseAdState(new URLSearchParams("played=7&since=2&adAge=45&adSec=6&seen=41f1e639-1111-4222-8333-444455556661,not-a-uuid"));
    expect(s).toMatchObject({ played: 7, sinceBreak: 2, lastBreakAgeMs: 45_000, adSecondsLast10Min: 6 });
    expect(s.seen).toEqual(["41f1e639-1111-4222-8333-444455556661"]);
    const empty = parseAdState(new URLSearchParams("played=-3&since=abc"));
    expect(empty).toMatchObject({ played: 0, sinceBreak: 0, lastBreakAgeMs: null });
    expect(parseAdState(new URLSearchParams("played=4")).sinceBreak).toBeGreaterThan(100); // no break yet: gap rule off
  });

  it("summarises starts, completes and taps per slot", () => {
    const rows = summarizeAds(
      [{ id: "a", headline: "A", kind: "house", languages: ["hi"], active: true }, { id: "b", headline: "B", kind: "house", languages: null, active: false }],
      [{ slot_id: "a", event: "start" }, { slot_id: "a", event: "start" }, { slot_id: "a", event: "complete" }, { slot_id: "a", event: "tap" }, { slot_id: "a", event: "bogus" }],
    );
    expect(rows[0]).toMatchObject({ slotId: "a", starts: 2, completes: 1, taps: 1, tapRate: 0.5 });
    expect(rows[1]).toMatchObject({ slotId: "b", starts: 0, tapRate: null });
  });
});
