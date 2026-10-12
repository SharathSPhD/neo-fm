import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRateLimitState,
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
    const rule = pickRule(p)!;
    expect(rule.bucket).toBe(bucket);
    expect(rule.limit).toBe(limit);
  });
});

describe("pickRule (auth, report, method-awareness)", () => {
  it("limits the auth surface", () => {
    expect(pickRule("/auth/callback", "GET")).toEqual({ bucket: "auth:flow", limit: 30 });
    expect(pickRule("/sign-out", "POST")?.bucket).toBe("auth:flow");
    expect(pickRule("/sign-in", "POST")).toEqual({ bucket: "auth:submit", limit: 10 });
    expect(pickRule("/sign-up", "POST")?.bucket).toBe("auth:submit");
  });
  it("does not limit GET views of the sign-in/up pages", () => {
    expect(pickRule("/sign-in", "GET")).toBeNull();
    expect(pickRule("/sign-up", "GET")).toBeNull();
  });
  it.each(["/", "/pricing", "/library", "/songs/abc", "/songs/new", "/discover", "/s/abc"])(
    "does not limit page route %s",
    (p) => {
      expect(pickRule(p, "GET")).toBeNull();
    },
  );
  it("never throttles repeated page views", async () => {
    for (let i = 0; i < 200; i++) {
      const rule = pickRule("/", "GET");
      expect(rule).toBeNull();
    }
  });
  it("gives /api/report a tight anonymous-write budget", () => {
    expect(pickRule("/api/report", "POST")).toEqual({ bucket: "anon:report", limit: 5 });
  });
  it("only charges the generation budget for POST /api/songs", () => {
    expect(pickRule("/api/songs", "POST")?.bucket).toBe("songs:create");
    expect(pickRule("/api/songs", "GET")?.bucket).toBe("api:default");
  });
});

describe("enforceRateLimit (upstash)", () => {
  const rule: RateLimitRule = { bucket: "up", limit: 2 };
  beforeEach(() => {
    __resetRateLimitState();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses Upstash counts when reachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ result: 3 }, { result: 0 }, { result: 42 }])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await enforceRateLimit(mkReq({ ip: "9.9.9.9" }), rule);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.resetSeconds).toBe(42);
  });

  it("falls back to memory and trips the breaker on failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    const a = await enforceRateLimit(mkReq({ ip: "8.8.8.8" }), rule);
    const b = await enforceRateLimit(mkReq({ ip: "8.8.8.8" }), rule);
    const c = await enforceRateLimit(mkReq({ ip: "8.8.8.8" }), rule);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    // Breaker open: only the first request attempted Upstash.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory on a non-OK Upstash response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    const r = await enforceRateLimit(mkReq({ ip: "7.7.7.7" }), rule);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(1);
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
