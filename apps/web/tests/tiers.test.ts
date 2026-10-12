import { describe, expect, it } from "vitest";
import { planForTier, TIER_LYRIA_CAP_GBP } from "../lib/agent/tiers";

describe("tier economics", () => {
  it("scales the monthly Lyria envelope with the price paid", () => {
    expect(planForTier("free").userLyriaCapGbp).toBe(0.3);
    expect(planForTier("creator").userLyriaCapGbp).toBe(0.75);
    expect(planForTier("pro").userLyriaCapGbp).toBe(2);
    expect(TIER_LYRIA_CAP_GBP.creator).toBeLessThan(TIER_LYRIA_CAP_GBP.pro);
  });
  it("paying tiers use the pro agent; free uses the free agent; override wins", () => {
    expect(planForTier("creator").agent).toBe("pro");
    expect(planForTier(null).agent).toBe("free");
    expect(planForTier("pro", "free").agent).toBe("free");
  });
  it("one full render per job on every plan", () => {
    for (const t of ["free", "creator", "pro"] as const) expect(planForTier(t).maxLyriaCalls).toBe(1);
  });
});
