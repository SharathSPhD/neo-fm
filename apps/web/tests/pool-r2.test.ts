import { afterEach, describe, expect, it, vi } from "vitest";

import { POOL_CACHE_CONTROL, r2Configured, r2Key, r2Request, r2SetPoolCacheControl } from "../lib/pool/r2";

const env = { R2_ACCOUNT_ID: "acct", R2_BUCKET: "bkt", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK" };

afterEach(() => vi.unstubAllGlobals());

describe("pool R2 client", () => {
  it("maps pool audio paths to bucket keys", () => {
    expect(r2Key("tracks/pool/a b.mp3")).toBe("pool/a b.mp3");
    expect(r2Key("/pool/x.mp3")).toBe("pool/x.mp3");
  });

  it("is configured only when all four vars are set", () => {
    expect(r2Configured(env)).toBe(true);
    expect(r2Configured({ ...env, R2_SECRET_ACCESS_KEY: "" })).toBe(false);
  });

  it("signs requests deterministically without leaking the secret", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const at = new Date("2026-10-18T12:00:00Z");
    await r2Request("HEAD", "pool/a b.mp3", undefined, env, at);
    await r2Request("HEAD", "pool/a b.mp3", undefined, env, at);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe("https://acct.r2.cloudflarestorage.com/bkt/pool/a%20b.mp3");
    const a = (calls[0]![1].headers as Record<string, string>).authorization!;
    expect(a).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20261018\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(a).toBe((calls[1]![1].headers as Record<string, string>).authorization);
    expect(a).not.toContain("SK");
  });

  it("throws when not configured", async () => {
    await expect(r2Request("HEAD", "k", undefined, {})).rejects.toThrow("R2 env not configured");
  });

  it("uploads pool audio with a long immutable Cache-Control that is part of the signature", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await r2Request("PUT", "pool/a.mp3", Buffer.from("x"), env, new Date("2026-10-18T12:00:00Z"));
    const [, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!;
    const h = init.headers as Record<string, string>;
    expect(POOL_CACHE_CONTROL).toMatch(/max-age=31536000.*immutable/);
    expect(h["cache-control"]).toBe(POOL_CACHE_CONTROL);
    expect(h.authorization).toContain("SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date");
  });

  it("backfills Cache-Control with a self-copy that replaces metadata", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await r2SetPoolCacheControl("pool/a b.mp3", env, new Date("2026-10-18T12:00:00Z"));
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!;
    const h = init.headers as Record<string, string>;
    expect(init.method).toBe("PUT");
    expect(url).toBe("https://acct.r2.cloudflarestorage.com/bkt/pool/a%20b.mp3");
    expect(h["x-amz-copy-source"]).toBe("/bkt/pool/a%20b.mp3");
    expect(h["x-amz-metadata-directive"]).toBe("REPLACE");
    expect(h["cache-control"]).toBe(POOL_CACHE_CONTROL);
    expect(h["content-type"]).toBe("audio/mpeg");
    expect(h.authorization).toContain("x-amz-copy-source");
    expect(h.authorization).not.toContain("SK");
  });
});
