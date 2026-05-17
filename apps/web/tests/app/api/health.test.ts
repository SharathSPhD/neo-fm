import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the upstream reachability checks so the route handler returns
// fast and deterministically. The route imports neither helper from
// outside its own file, so we patch `globalThis.fetch` instead and let
// the existing helpers short-circuit on the missing env shape.

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_VERSION",
  "VERCEL_GIT_COMMIT_SHA",
  "HEALTH_INTERNAL_TOKEN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  // Both reachability probes will hit the missing-env branch and
  // return immediately — fine for these tests.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.unstubAllGlobals();
});

async function loadRoute() {
  return await import("../../../app/api/health/route");
}

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/health", { headers });
}

describe("/api/health (privacy gating)", () => {
  it("anonymous callers see version=production and no commit", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.3-wedge";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const { GET } = await loadRoute();
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.version).toBe("production");
    expect(body.commit).toBeNull();
  });

  it("internal-token callers see the rich payload", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.3-wedge";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    process.env.HEALTH_INTERNAL_TOKEN = "internal-shared-secret";
    const { GET } = await loadRoute();
    const res = await GET(
      makeReq({ authorization: "Bearer internal-shared-secret" }),
    );
    const body = await res.json();
    expect(body.version).toBe("v1.3-wedge");
    expect(body.commit).toBe("abcdef1");
  });

  it("wrong internal token is still treated as anonymous", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.3-wedge";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    process.env.HEALTH_INTERNAL_TOKEN = "real-secret";
    const { GET } = await loadRoute();
    const res = await GET(makeReq({ authorization: "Bearer wrong-secret" }));
    const body = await res.json();
    expect(body.version).toBe("production");
    expect(body.commit).toBeNull();
  });

  it("Supabase auth cookie unlocks the rich payload", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.3-wedge";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const { GET } = await loadRoute();
    const res = await GET(
      makeReq({ cookie: "sb-abcd1234-auth-token=eyJpZCI6MX0=" }),
    );
    const body = await res.json();
    expect(body.version).toBe("v1.3-wedge");
    expect(body.commit).toBe("abcdef1");
  });

  it("unrelated cookies do not unlock the rich payload", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.3-wedge";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const { GET } = await loadRoute();
    const res = await GET(makeReq({ cookie: "marketing_consent=1" }));
    const body = await res.json();
    expect(body.version).toBe("production");
    expect(body.commit).toBeNull();
  });

  it("missing env vars still produce a non-leaking anonymous payload", async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.version).toBe("production");
    expect(body.commit).toBeNull();
    expect(body.status).toMatch(/^(ok|degraded|missing)$/);
  });
});
