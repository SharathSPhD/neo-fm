import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enforceRateLimit,
  pickRule,
  type RateLimitRule,
} from "../../lib/rate-limit";

function mkReq(opts: {
  ip?: string;
  pathname?: string;
  method?: string;
}): { headers: Headers; nextUrl: URL; method: string } {
  const headers = new Headers();
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  return {
    headers,
    nextUrl: new URL(
      `https://neo-fm.app${opts.pathname ?? "/api/songs"}`,
    ),
    method: opts.method ?? "POST",
  };
}

describe("pickRule", () => {
  it.each<[string, RateLimitRule["bucket"], number]>([
    ["/api/songs", "songs:create", 6],
    [
      "/api/songs/abc-123/sections/verse-1/regenerate",
      "songs:regen",
      6,
    ],
    ["/api/songs/abc-123/publish", "songs:publish", 30],
    ["/api/songs/abc-123/variation", "songs:gen-aux", 6],
    ["/api/songs/abc-123/remix", "songs:gen-aux", 6],
    ["/api/songs/abc-123/cover-art", "songs:gen-aux", 6],
    ["/api/p/abc/audio-url", "public:read", 120],
    ["/api/p/abc", "public:read", 120],
    ["/api/lyrics", "api:default", 60],
    ["/api/me", "api:default", 60],
  ])("picks rule for %s", (p, bucket, limit) => {
    const rule = pickRule(p);
    expect(rule.bucket).toBe(bucket);
    expect(rule.limit).toBe(limit);
  });
});

describe("enforceRateLimit (memory fallback)", () => {
  beforeEach(() => {
    // Use a fresh IP per test so windows don't collide.
    vi.unstubAllEnvs();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("counts down and 429s once the budget is exhausted", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const rule: RateLimitRule = {
      bucket: `test:${Math.random()}`,
      limit: 3,
    };

    const r1 = await enforceRateLimit(mkReq({ ip }), rule);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);
    const r2 = await enforceRateLimit(mkReq({ ip }), rule);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(1);
    const r3 = await enforceRateLimit(mkReq({ ip }), rule);
    expect(r3.ok).toBe(true);
    expect(r3.remaining).toBe(0);
    const r4 = await enforceRateLimit(mkReq({ ip }), rule);
    expect(r4.ok).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("isolates buckets per IP", async () => {
    const rule: RateLimitRule = {
      bucket: `iso:${Math.random()}`,
      limit: 1,
    };
    const a = await enforceRateLimit(mkReq({ ip: "1.1.1.1" }), rule);
    const b = await enforceRateLimit(mkReq({ ip: "1.1.1.2" }), rule);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
