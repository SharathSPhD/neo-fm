import { describe, expect, it, vi } from "vitest";

import { remoteDailyCap } from "../../../scripts/quality/remote-daily-cap";

const env = { POOL_BASE_URL: "https://x.test/", MA_PROD_ADMIN_SECRET: "s" };

describe("remoteDailyCap", () => {
  it("counts one batch request per reserve and stops on 429", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 429 }));
    const cap = remoteDailyCap("lyria", env, f as unknown as typeof fetch);
    expect(await cap.reserve()).toBe(true);
    expect(await cap.reserve()).toBe(false);
    expect(f.mock.calls[0]![0]).toBe("https://x.test/api/admin/provider-cap");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ provider: "lyria", class: "batch" });
  });

  it("fails closed when the endpoint errors or the env is missing", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await expect(remoteDailyCap("lyria", env, f as unknown as typeof fetch).reserve()).rejects.toThrow(/500/);
    expect(() => remoteDailyCap("lyria", {})).toThrow(/POOL_BASE_URL/);
  });
});
