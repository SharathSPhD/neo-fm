import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFunnel } from "@/lib/ops/funnel";
import { utmFromSearch } from "@/lib/ops/utm";
import { withShareUtm } from "@/lib/share/attribution";
import { LAUNCH_LANGUAGES, trackIndexable } from "@/lib/seo/pool-tracks";
import { musicRecordingLd } from "@/lib/seo/jsonld";

describe("withShareUtm", () => {
  it("tags a bare url", () => {
    expect(withShareUtm("https://x.test/s/abc", "whatsapp", "song")).toBe(
      "https://x.test/s/abc?utm_source=whatsapp&utm_medium=share&utm_campaign=share-song",
    );
  });
  it("keeps existing params and the hash, and replaces earlier utm labels", () => {
    const u = withShareUtm("https://x.test/s/abc?lang=ta&utm_source=old#top", "copy", "clip");
    expect(u).toBe("https://x.test/s/abc?lang=ta&utm_source=copy&utm_medium=share&utm_campaign=share-clip#top");
  });
  it("is read back by the funnel's utm parser as a share-medium campaign", () => {
    const q = withShareUtm("https://x.test/t/1", "native", "track").split("?")[1]!;
    expect(utmFromSearch(q)).toEqual({ source: "native", medium: "share", campaign: "share-track", content: "" });
  });
});

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
  it("is off by default and limited to launch languages when on", () => {
    expect(trackIndexable("hi")).toBe(false);
    vi.stubEnv("SEO_POOL_TRACKS", "1");
    for (const l of LAUNCH_LANGUAGES) expect(trackIndexable(l)).toBe(true);
    expect(trackIndexable("bn")).toBe(false);
    expect(trackIndexable("en")).toBe(false);
  });
  it("points the recording at /t/<id> and has no embed", () => {
    const ld = musicRecordingLd({ base: "https://x.test", publicId: "id", path: "/t/id", name: "n", language: "mr" });
    expect(ld.url).toBe("https://x.test/t/id");
    expect(ld).not.toHaveProperty("audio");
  });
});
