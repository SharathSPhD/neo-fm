import { describe, expect, it } from "vitest";

import { AD_CAPS, TIER_CAPS, adHoldoutPct, inAdHoldout, adItem, adLabel, eligibleSlots, pickAd, placeAd, tracksBeforeBreak, weightedPick, type AdContext, type AdSlot } from "../lib/station/ads";
import { parseAdState } from "../lib/station/ads-server";
import { summarizeAds } from "../lib/ops/ads-report";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const slot = (o: Partial<AdSlot> = {}): AdSlot => ({
  id: "s1", kind: "house", sponsorName: null, headline: "Gift a song", ctaLabel: "Gift", ctaUrl: "/gift", audioPath: null, durationSeconds: null,
  languages: [], dayparts: [], excludedTags: [], aiMade: false, weight: 1, startAt: null, endAt: null, active: true, reviewedAt: "2026-11-01T00:00:00Z", ...o,
});
const ctx = (o: Partial<AdContext> = {}): AdContext => ({
  enabled: true, tier: "free", language: null, hour: 10, now: NOW, played: 5, sinceBreak: 5, lastBreakAgeMs: null,
  adSecondsLast10Min: 0, adsLastHour: 0, adsToday: 0, perCreativeToday: {}, ...o,
});
const tracks = (...tags: string[][]) => tags.map((t) => ({ tags: t }));
const six = tracks(["calm"], ["calm"], ["calm"], ["calm"], ["calm"], ["calm"]);
const TIERS = ["free", "creator", "pro"] as const;
const long = tracks(...Array.from({ length: 24 }, () => ["calm"]));

describe("ad caps by tier", () => {
  it("spaces breaks by tier: Free 6 tracks, Creator 9, Pro 18; first break after 2, 3 and 5 tracks", () => {
    for (const [tier, between, first] of [["free", 6, 2], ["creator", 9, 3], ["pro", 18, 5]] as const) {
      expect(tracksBeforeBreak({ tier, played: 0, sinceBreak: 0 })).toBe(between);
      expect(tracksBeforeBreak({ tier, played: 0, sinceBreak: 1000 })).toBe(first);
      expect(tracksBeforeBreak({ tier, played: 40, sinceBreak: between })).toBe(0);
    }
    expect(tracksBeforeBreak({ tier: null, played: 40, sinceBreak: 40 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("lighter tiers hear fewer breaks: the table only gets stricter from Free to Pro", () => {
    expect(TIER_CAPS.free.perHour).toBeGreaterThan(TIER_CAPS.creator.perHour);
    expect(TIER_CAPS.creator.perHour).toBeGreaterThan(TIER_CAPS.pro.perHour);
    expect(TIER_CAPS.free.perDay).toBeGreaterThan(TIER_CAPS.creator.perDay);
    expect(TIER_CAPS.creator.perDay).toBeGreaterThan(TIER_CAPS.pro.perDay);
    expect(TIER_CAPS.free.minGapMs).toBeLessThan(TIER_CAPS.creator.minGapMs);
    expect(TIER_CAPS.creator.minGapMs).toBeLessThan(TIER_CAPS.pro.minGapMs);
  });

  it("never puts an ad before the tier's first-break track", () => {
    const free = pickAd([slot()], long, ctx({ played: 0, sinceBreak: 1000 }), () => 0);
    expect(free?.index).toBe(2);
    expect(pickAd([slot()], long, ctx({ tier: "creator", played: 0, sinceBreak: 1000 }), () => 0)?.index).toBe(3);
    expect(pickAd([slot()], long, ctx({ tier: "pro", played: 0, sinceBreak: 1000 }), () => 0)?.index).toBe(5);
    expect(pickAd([slot()], long, ctx({ played: 1, sinceBreak: 1000 }), () => 0)?.index).toBe(1);
  });

  it("allows one break per N tracks for each tier", () => {
    for (const [tier, n] of [["free", 6], ["creator", 9], ["pro", 18]] as const) {
      expect(pickAd([slot()], long, ctx({ tier, played: 40, sinceBreak: 1 }), () => 0)?.index).toBe(n - 1);
      expect(pickAd([slot()], long, ctx({ tier, played: 40, sinceBreak: n }), () => 0)?.index).toBe(0);
    }
  });

  it("returns nothing when the slice is too short to hold the break; the next refill tries again", () => {
    expect(pickAd([slot()], tracks(["a"], ["b"]), ctx({ played: 10, sinceBreak: 0 }))).toBeNull();
  });

  it("keeps the tier's gap between breaks", () => {
    for (const tier of ["free", "creator", "pro"] as const) {
      const gap = TIER_CAPS[tier].minGapMs;
      expect(pickAd([slot()], long, ctx({ tier, lastBreakAgeMs: gap - 1000 }))).toBeNull();
      expect(pickAd([slot()], long, ctx({ tier, lastBreakAgeMs: gap + 1000 }))).not.toBeNull();
    }
  });

  it("caps breaks per hour, spots per day and ad seconds per 10 minutes by tier", () => {
    for (const tier of ["free", "creator", "pro"] as const) {
      const caps = TIER_CAPS[tier];
      expect(pickAd([slot()], long, ctx({ tier, adsLastHour: caps.perHour }))).toBeNull();
      expect(pickAd([slot()], long, ctx({ tier, adsLastHour: caps.perHour - 1 }))).not.toBeNull();
      expect(pickAd([slot()], long, ctx({ tier, adsToday: caps.perDay }))).toBeNull();
      expect(pickAd([slot()], long, ctx({ tier, adsToday: caps.perDay - 1 }))).not.toBeNull();
      expect(pickAd([slot()], long, ctx({ tier, perCreativeToday: { s1: caps.creativePerDay } }))).toBeNull();
      expect(pickAd([slot()], long, ctx({ tier, perCreativeToday: { s1: caps.creativePerDay - 1 } }))).not.toBeNull();
    }
    // 15 s per 10 minutes: a card-only spot counts as 6 s.
    expect(pickAd([slot()], long, ctx({ adSecondsLast10Min: 9 }))).not.toBeNull();
    expect(pickAd([slot()], long, ctx({ adSecondsLast10Min: 10 }))).toBeNull();
  });

  it("one spot is at most 15 s: longer audio is never served", () => {
    expect(pickAd([slot({ audioPath: "ads/a.mp3", durationSeconds: 15 })], long, ctx())).not.toBeNull();
    expect(pickAd([slot({ audioPath: "ads/a.mp3", durationSeconds: 16 })], long, ctx())).toBeNull();
  });

  it("Pro gets card-only spots, never audio", () => {
    const audio = slot({ id: "aud", audioPath: "ads/a.mp3", durationSeconds: 10 });
    const card = slot({ id: "card" });
    expect(pickAd([audio], long, ctx({ tier: "pro" }))).toBeNull();
    expect(pickAd([audio, card], long, ctx({ tier: "pro" }), () => 0)?.slot.id).toBe("card");
    expect(pickAd([audio], long, ctx({ tier: "creator" }))).not.toBeNull();
    expect(pickAd([audio], long, ctx({ tier: "free" }))).not.toBeNull();
  });

  it("the Station pass hears nothing, and ads off means nothing for everyone", () => {
    expect(pickAd([slot()], long, ctx({ tier: null }))).toBeNull();
    for (const tier of TIERS) expect(pickAd([slot()], long, ctx({ tier, enabled: false }))).toBeNull();
  });

  it("house spots are skippable after 3 s, sponsor spots are not skippable", () => {
    expect(adItem(slot(), "", "n", "free").ad.skipAfterMs).toBe(3000);
    expect(adItem(slot(), "", "n", "pro").ad.skipAfterMs).toBe(3000);
    expect(adItem(slot({ kind: "sponsor", sponsorName: "Acme" }), "", "n", "free").ad.skipAfterMs).toBeNull();
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
    expect(placeAd(slot(), t, { tier: "free", played: 1, sinceBreak: 4 })).toBe(3);
  });

  it("never plays directly after a sad or farewell track", () => {
    const t = tracks(["calm"], ["sad"], ["calm"], ["calm"]);
    expect(placeAd(slot(), t, { tier: "free", played: 2, sinceBreak: 3 })).toBe(3);
  });

  it("slides past a slot's own excluded tags", () => {
    const t = tracks(["calm"], ["party"], ["calm"], ["calm"]);
    expect(placeAd(slot({ excludedTags: ["party"] }), t, { tier: "free", played: 10, sinceBreak: 4 })).toBe(3);
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
    const s = parseAdState(new URLSearchParams("played=7&since=2&adAge=45&adSec=6&adHr=2&seen=41f1e639-1111-4222-8333-444455556661,not-a-uuid"));
    expect(s).toMatchObject({ played: 7, sinceBreak: 2, lastBreakAgeMs: 45_000, adSecondsLast10Min: 6, adsLastHour: 2 });
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

describe("adTierFor", () => {
  it("falls back to Free when the tier lookup is unavailable, and to Free for visitors", async () => {
    const { adTierFor } = await import("../lib/station/ads-server");
    const broken = { rpc: async () => ({ data: false, error: null }), from: () => { throw new Error("down"); } } as never;
    expect(await adTierFor(broken, "u1")).toBe("free");
    expect(await adTierFor(broken, null)).toBe("free");
  });
});

describe("ad holdout", () => {
  it("is stable per listener and close to the requested share", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(ids.map((i) => inAdHoldout(i, 10))).toEqual(ids.map((i) => inAdHoldout(i, 10)));
    const share = ids.filter((i) => inAdHoldout(i, 10)).length / ids.length;
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.13);
    expect(ids.some((i) => inAdHoldout(i, 0))).toBe(false);
  });
  it("reads ADS_HOLDOUT_PCT, defaulting to 10 and capping at 50", () => {
    expect(adHoldoutPct({} as NodeJS.ProcessEnv)).toBe(10);
    expect(adHoldoutPct({ ADS_HOLDOUT_PCT: "0" } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(adHoldoutPct({ ADS_HOLDOUT_PCT: "90" } as unknown as NodeJS.ProcessEnv)).toBe(50);
    expect(adHoldoutPct({ ADS_HOLDOUT_PCT: "x" } as unknown as NodeJS.ProcessEnv)).toBe(10);
  });
});
