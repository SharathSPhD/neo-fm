import { describe, expect, it, vi } from "vitest";

import { DailyCapError, SpendCapError, generateMusic } from "../lib/agent/lyria";
import { failureCode } from "../lib/agent/process";
import { friendlyJobError } from "../components/job-progress";
import { dailyCap, dailyLimits, providerDay } from "../lib/ops/provider-cap";

const okBody = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: Buffer.from("x").toString("base64") } }] } }] };
const guard = () => ({ reserve: vi.fn(async () => true), release: vi.fn(async () => {}) });
const args = { stylePrompt: "s", lyrics: "l", durationClass: "clip" as const };

describe("dailyLimits", () => {
  it("keeps 200 of Lyria's 450 for listeners and stops Veo and TTS at 90% of their caps", () => {
    expect(dailyLimits("lyria", {})).toEqual({ total: 450, batch: 250 });
    expect(dailyLimits("veo", {})).toEqual({ total: 9, batch: 9 });
    expect(dailyLimits("tts", {})).toEqual({ total: 90, batch: 90 });
  });
  it("reads env overrides and never lets the batch share exceed the total", () => {
    expect(dailyLimits("lyria", { LYRIA_DAILY_CAP: "100", LYRIA_BATCH_DAILY_CAP: "400" })).toEqual({ total: 100, batch: 100 });
    expect(dailyLimits("lyria", { LYRIA_DAILY_CAP: "nope" })).toEqual({ total: 450, batch: 250 });
  });
});

describe("providerDay", () => {
  it("rolls over at midnight Pacific (07:00 UTC in PDT)", () => {
    expect(providerDay(new Date("2026-10-18T06:59:00Z"))).toBe("2026-10-17");
    expect(providerDay(new Date("2026-10-18T07:00:00Z"))).toBe("2026-10-18");
  });
});

describe("dailyCap", () => {
  it("passes the class and limits to the counter and returns its answer", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await dailyCap({ rpc } as never, "lyria", "batch", {}).reserve()).toBe(false);
    expect(rpc).toHaveBeenCalledWith("reserve_provider_call", { p_provider: "lyria", p_bucket: "batch", p_total_cap: 450, p_batch_cap: 250 });
  });
  it("fails open when the migration is not applied or the call throws", async () => {
    expect(await dailyCap({ rpc: async () => ({ data: null, error: { message: "no function" } }) } as never, "tts", "user", {}).reserve()).toBe(true);
    expect(await dailyCap({ rpc: async () => { throw new Error("down"); } } as never, "tts", "user", {}).reserve()).toBe(true);
  });
});

describe("generateMusic with a daily cap", () => {
  it("refuses before any request and gives the spend reservation back", async () => {
    const g = guard();
    const f = vi.fn();
    await expect(generateMusic(args, { guard: g, dailyCap: { reserve: async () => false }, apiKey: "k", fetchImpl: f as never })).rejects.toBeInstanceOf(DailyCapError);
    expect(f).not.toHaveBeenCalled();
    expect(g.release).toHaveBeenCalledTimes(1);
  });
  it("is still a SpendCapError, so existing refusal handling applies", () => {
    expect(new DailyCapError()).toBeInstanceOf(SpendCapError);
  });
  it("counts every retry as a request and stops retrying once the cap is spent", async () => {
    const reserve = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const f = vi.fn(async () => new Response("x", { status: 503 }));
    await expect(generateMusic(args, { guard: guard(), dailyCap: { reserve }, apiKey: "k", fetchImpl: f as never, attempts: 3, retryDelayMs: 0 })).rejects.toBeInstanceOf(DailyCapError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(2);
  });
  it("renders normally while under the cap", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const r = await generateMusic(args, { guard: guard(), dailyCap: { reserve: async () => true }, apiKey: "k", fetchImpl: f as never });
    expect(r.mimeType).toBe("audio/mpeg");
  });
});

describe("what the listener sees", () => {
  it("maps the daily cap to a friendly busy message, not the monthly allowance one", () => {
    expect(failureCode(new DailyCapError().message)).toBe("provider_busy");
    expect(friendlyJobError("provider_busy")).toMatch(/busy/i);
    expect(friendlyJobError("provider_busy")).not.toMatch(/allowance reset|1st/i);
    expect(failureCode("Lyria spend cap reached")).toBe("allowance_reached");
  });
});
