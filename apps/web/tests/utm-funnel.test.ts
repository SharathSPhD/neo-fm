// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFunnel } from "../lib/ops/funnel";
import { cleanUtm, utmFromSearch } from "../lib/ops/utm";

const rpc = vi.fn();
vi.mock("../lib/agent/adapters", () => ({ serviceClient: () => ({ rpc }) }));
import { POST } from "../app/api/events/route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://x/api/events", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }));

describe("utm labels", () => {
  it("keeps only the four labels, as short lower-case slugs", () => {
    expect(utmFromSearch("?utm_source=Instagram&utm_medium=Social&utm_campaign=Diwali%202026&utm_content=Reel_1&x=1")).toEqual({
      source: "instagram", medium: "social", campaign: "diwali-2026", content: "reel_1",
    });
    expect(cleanUtm({ source: "a".repeat(100), campaign: "<script>" })).toEqual({ source: "a".repeat(40), medium: "", campaign: "script", content: "" });
  });

  it("is null without a source or campaign", () => {
    expect(utmFromSearch("")).toBeNull();
    expect(utmFromSearch("?utm_medium=social")).toBeNull();
    expect(cleanUtm("nope")).toBeNull();
    expect(cleanUtm(null)).toBeNull();
  });
});

describe("campaign breakdown", () => {
  it("sums events per campaign, busiest first, and ignores unknown events", () => {
    const f = buildFunnel([], { signups: 0, firstSongUsers: 0, shared: 0, gifted: 0, paidUsers: 0 }, 7, [
      { event: "landing_view", source: "instagram", medium: "social", campaign: "diwali", content: "a", n: 30 },
      { event: "landing_view", source: "instagram", medium: "social", campaign: "diwali", content: "b", n: 20 },
      { event: "signup_view", source: "instagram", medium: "social", campaign: "diwali", content: "a", n: 10 },
      { event: "landing_view", source: "whatsapp", medium: "share", campaign: "gift", content: "", n: 5 },
      { event: "bogus", source: "x", medium: "", campaign: "z", content: "", n: 99 },
    ]);
    expect(f.by_campaign.map((c) => c.campaign)).toEqual(["diwali", "gift"]);
    expect(f.by_campaign[0]!.events).toEqual({ landing_view: 50, signup_view: 10 });
  });

  it("is empty when there are no campaign rows (migration 0104 not applied)", () => {
    expect(buildFunnel([], { signups: 0, firstSongUsers: 0, shared: 0, gifted: 0, paidUsers: 0 }, 7).by_campaign).toEqual([]);
  });
});

describe("POST /api/events with utm", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); });
  afterEach(() => vi.clearAllMocks());

  it("counts the plain event and the campaign counter", async () => {
    const res = await post({ event: "landing_view", utm: { source: "Instagram", campaign: "Diwali" } });
    expect(res.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("bump_funnel", { p_event: "landing_view" });
    expect(rpc).toHaveBeenCalledWith("bump_funnel_campaign", { p_event: "landing_view", p_source: "instagram", p_medium: "", p_campaign: "diwali", p_content: "" });
  });

  it("counts only the plain event without a campaign", async () => {
    await post({ event: "landing_view" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("still answers 204 when the campaign function is missing", async () => {
    rpc.mockImplementation(async (fn: string) => { if (fn === "bump_funnel_campaign") throw new Error("PGRST202"); return { error: null }; });
    expect((await post({ event: "landing_view", utm: { source: "x" } })).status).toBe(204);
  });

  it("counts nothing for DNT or an unknown event", async () => {
    await post({ event: "landing_view", utm: { source: "x" } }, { dnt: "1" });
    expect(rpc).not.toHaveBeenCalled();
    expect((await post({ event: "drop table", utm: { source: "x" } })).status).toBe(400);
  });
});
