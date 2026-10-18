import { describe, expect, it, vi } from "vitest";

import { ttlCache } from "../lib/station/cache";

describe("ttlCache", () => {
  it("serves from cache within the ttl and reloads after it", async () => {
    let t = 0;
    const load = vi.fn(async () => [1]);
    const get = ttlCache(load, 1000, () => t);
    await get();
    t = 999;
    await get();
    expect(load).toHaveBeenCalledTimes(1);
    t = 1001;
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not cache an empty result", async () => {
    const load = vi.fn(async () => [] as number[]);
    const get = ttlCache(load, 1000, () => 0);
    await get();
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("shares one load between concurrent callers", async () => {
    const load = vi.fn(async () => [1]);
    const get = ttlCache(load, 1000, () => 0);
    await Promise.all([get(), get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
