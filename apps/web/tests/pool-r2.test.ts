import { afterEach, describe, expect, it, vi } from "vitest";

import { r2Configured, r2Key, r2Request } from "../lib/pool/r2";

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
});
