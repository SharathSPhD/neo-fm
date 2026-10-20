import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFunnel } from "@/lib/ops/funnel";
import { LAUNCH_LANGUAGES, trackIndexable } from "@/lib/seo/pool-tracks";
import { musicRecordingLd } from "@/lib/seo/jsonld";

describe("share loop summary", () => {
  const zero = { signups: 0, firstSongUsers: 0, shared: 0, gifted: 0, paidUsers: 0 };
  it("counts only share-medium campaigns, per channel", () => {
    const f = buildFunnel([], zero, 7, [
      { event: "share_view", source: "whatsapp", medium: "share", campaign: "share-track", content: "", n: 40 },
      { event: "signup_view", source: "whatsapp", medium: "share", campaign: "share-track", content: "", n: 8 },
      { event: "share_view", source: "copy", medium: "share", campaign: "share-song", content: "", n: 10 },
      { event: "share_view", source: "instagram", medium: "social", campaign: "diwali", content: "", n: 99 },
    ]);
    expect(f.share_loop.visits).toBe(50);
    expect(f.share_loop.signup_views).toBe(8);
    expect(f.share_loop.visit_to_signup_view).toBe(0.16);
    expect(f.share_loop.by_channel.map((c) => c.channel)).toEqual(["whatsapp", "copy"]);
  });
  it("is empty without campaign rows", () => {
    expect(buildFunnel([], zero, 7).share_loop).toEqual({ visits: 0, signup_views: 0, visit_to_signup_view: null, by_channel: [] });
  });
});

describe("pool track indexing", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is off by default, and when on covers launch plus LANG_REVIEWED languages", () => {
    expect(trackIndexable("hi")).toBe(false);
    vi.stubEnv("SEO_POOL_TRACKS", "1");
    vi.stubEnv("LANG_REVIEWED", "");
    for (const l of LAUNCH_LANGUAGES) expect(trackIndexable(l)).toBe(true);
    expect(trackIndexable("bn")).toBe(false);
    expect(trackIndexable("en")).toBe(false);
    vi.stubEnv("LANG_REVIEWED", "mr, pa,ml,gu,bn");
    for (const l of ["pa", "ml", "gu", "bn"]) expect(trackIndexable(l)).toBe(true);
    expect(trackIndexable("en")).toBe(false);
  });
  it("points the recording at /t/<id> and has no embed", () => {
    const ld = musicRecordingLd({ base: "https://x.test", publicId: "id", path: "/t/id", name: "n", language: "hi" });
    expect(ld.url).toBe("https://x.test/t/id");
    expect(ld).not.toHaveProperty("audio");
  });
});
