import { describe, expect, it } from "vitest";
import { CostCollector, summariseAnthropicUsage, summariseGeminiUsage, summariseSessionUsage } from "../lib/cost/usage";

describe("summariseSessionUsage", () => {
  it("maps cumulative session usage and keeps list_cost verbatim", () => {
    const s = summariseSessionUsage({
      input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 5000, active_seconds: 212,
      cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 100 },
      list_cost: { amount: "42", currency: "USD" },
    });
    expect(s).toEqual({ in: 1200, out: 800, cache_read: 5000, cache_write: 400, active_s: 212, list_cost: { amount: "42", currency: "USD" } });
  });
  it("tolerates missing, null and junk fields", () => {
    expect(summariseSessionUsage(null)).toBeNull();
    expect(summariseSessionUsage({ input_tokens: -3, list_cost: null, output_tokens: "x" })).toEqual({ in: 0, out: 0, cache_read: 0, cache_write: 0, active_s: null, list_cost: null });
  });
});

describe("provider usage summaries", () => {
  it("anthropic messages usage", () => {
    expect(summariseAnthropicUsage("m", { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 })).toEqual({ model: "m", in: 10, out: 5, cache_read: 2, cache_write: 0 });
  });
  it("gemini usageMetadata counts thinking tokens as output", () => {
    expect(summariseGeminiUsage("g", { promptTokenCount: 1300, candidatesTokenCount: 90, thoughtsTokenCount: 10 })).toEqual({ model: "g", in: 1300, out: 100, cache_read: 0 });
    expect(summariseGeminiUsage("g", undefined)).toEqual({ model: "g", in: 0, out: 0, cache_read: 0 });
  });
});

describe("CostCollector", () => {
  it("omits parts that never reported", () => {
    const c = new CostCollector();
    expect(JSON.parse(JSON.stringify(c))).toEqual({});
    c.lyria(0);
    c.session(undefined);
    expect(c.toJSON()).toEqual({});
    c.lyria(1);
    c.qa({ model: "g", in: 1, out: 2 });
    expect(c.toJSON()).toEqual({ lyria_renders: 1, qa: { model: "g", in: 1, out: 2 } });
  });
});
