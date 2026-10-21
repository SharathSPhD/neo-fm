import { describe, expect, it } from "vitest";
import { premiumPolishModel } from "../lib/lyrics/premium";

describe("premiumPolishModel", () => {
  const env = { PCE_PREMIUM_POLISH: "kn, hi" };
  it("is off when the flag is unset or empty", () => {
    expect(premiumPolishModel({}, "pro", "kn")).toBeUndefined();
    expect(premiumPolishModel({ PCE_PREMIUM_POLISH: "" }, "pro", "kn")).toBeUndefined();
  });
  it("gives Opus to paid tiers in listed languages only", () => {
    expect(premiumPolishModel(env, "creator", "kn")).toBe("claude-opus-5-5");
    expect(premiumPolishModel(env, "pro", "HI")).toBe("claude-opus-5-5");
    expect(premiumPolishModel(env, "developer", "hi")).toBe("claude-opus-5-5");
    expect(premiumPolishModel(env, "pro", "ta")).toBeUndefined();
  });
  it("never applies to free or unknown tiers", () => {
    expect(premiumPolishModel(env, "free", "kn")).toBeUndefined();
    expect(premiumPolishModel(env, null, "kn")).toBeUndefined();
    expect(premiumPolishModel(env, undefined, "hi")).toBeUndefined();
  });
});
