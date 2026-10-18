import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { buildPost, AI_LABEL } from "../lib/social/caption";
import { socialFlags } from "../lib/social/config";
import { open, seal, signState, verifyState } from "../lib/social/crypto";
import { facebookAdapter } from "../lib/social/platforms/meta";
import { youtube } from "../lib/social/platforms/youtube";
import { tiktok } from "../lib/social/platforms/tiktok";
import { ADAPTERS } from "../lib/social/platforms";
import { holdReason, runPublish, type PublishStore, type QueueRow } from "../lib/social/publish";

const key = randomBytes(32).toString("base64");
const baseEnv = { SOCIAL_PUBLISH_ENABLED: "1", SOCIAL_PLATFORMS: "youtube,instagram", SOCIAL_TOKEN_KEY: key, YOUTUBE_CLIENT_ID: "a", YOUTUBE_CLIENT_SECRET: "b" } as unknown as NodeJS.ProcessEnv;

const row = (o: Partial<QueueRow> = {}): QueueRow => ({
  id: "r1", platform: "youtube", video_path: "v/hi-1.mp4", title: "t", caption: "c", visibility: "private",
  needs_native_read: false, native_read_ok: false, approved_at: "2026-10-18T00:00:00Z", attempts: 0, ...o,
});

function store(rows: QueueRow[] | "missing_table", extra: Partial<PublishStore> = {}) {
  const finish = vi.fn(async () => {});
  const s: PublishStore = {
    due: async () => rows,
    claim: async () => true,
    account: async () => ({ secretSealed: seal("refresh", baseEnv), extra: {} }),
    signedUrl: async () => "https://signed/v.mp4",
    finish,
    ...extra,
  };
  return { s, finish };
}

describe("flags", () => {
  it("is off by default and parses the platform list", () => {
    expect(socialFlags({} as NodeJS.ProcessEnv)).toMatchObject({ enabled: false, platforms: [], allowPublic: false, perRun: 1 });
    expect(socialFlags({ SOCIAL_PUBLISH_ENABLED: "1", SOCIAL_PLATFORMS: "youtube, nope ,tiktok", SOCIAL_PER_RUN: "99" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ enabled: true, platforms: ["youtube", "tiktok"], perRun: 5 });
  });
});

describe("crypto", () => {
  it("round-trips and rejects tampering", () => {
    const env = { SOCIAL_TOKEN_KEY: key } as unknown as NodeJS.ProcessEnv;
    const s = seal("tok", env);
    expect(s).not.toContain("tok");
    expect(open(s, env)).toBe("tok");
    expect(() => open(s.slice(0, -4) + "AAAA", env)).toThrow();
    expect(() => seal("x", {} as NodeJS.ProcessEnv)).toThrow();
  });
  it("signs state per platform with expiry", () => {
    const st = signState("youtube", "sec", 1000, 5000);
    expect(verifyState(st, "youtube", "sec", 2000)).toBe(true);
    expect(verifyState(st, "tiktok", "sec", 2000)).toBe(false);
    expect(verifyState(st, "youtube", "other", 2000)).toBe(false);
    expect(verifyState(st, "youtube", "sec", 7000)).toBe(false);
    expect(verifyState("junk", "youtube", "sec")).toBe(false);
  });
});

describe("caption", () => {
  it("carries the AI label, UTM link back, and flags non-English for a native read", () => {
    const p = buildPost({ title: "Subah", language: "hi" }, "youtube", "id-1", "https://x.test");
    expect(p.caption).toContain(AI_LABEL);
    expect(p.caption).toContain("utm_source=youtube");
    expect(p.caption).toContain("#Shorts");
    expect(p.needsNativeRead).toBe(true);
    expect(buildPost({ title: "A", language: "en" }, "tiktok", "id", "https://x.test").needsNativeRead).toBe(false);
  });
});

describe("holdReason", () => {
  const flags = socialFlags(baseEnv);
  it("holds unapproved, unread-caption and Meta-private rows", () => {
    expect(holdReason(row({ approved_at: null }), flags)).toMatch(/not approved/);
    expect(holdReason(row({ needs_native_read: true }), flags)).toMatch(/native/);
    expect(holdReason(row({ platform: "instagram", visibility: "public" }), flags)).toMatch(/Meta/);
    expect(holdReason(row({ platform: "instagram", visibility: "public" }), { ...flags, allowPublic: true })).toBeNull();
    expect(holdReason(row(), flags)).toBeNull();
  });
});

describe("runPublish", () => {
  it("does nothing when disabled, with no platforms, or when the table is missing", async () => {
    const { s } = store([row()]);
    expect((await runPublish(s, {} as NodeJS.ProcessEnv)).ran).toBe(false);
    expect((await runPublish(s, { SOCIAL_PUBLISH_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).reason).toMatch(/PLATFORMS/);
    expect((await runPublish(store("missing_table").s, baseEnv)).reason).toMatch(/0103/);
  });

  it("uploads private with the synthetic-media flag and adds to the playlist", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, init });
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "at" }));
      if (url === "https://signed/v.mp4") return new Response(new Uint8Array([1, 2, 3]));
      if (url.includes("uploadType=resumable")) return new Response("{}", { headers: { location: "https://upload.example/1" } });
      if (url === "https://upload.example/1") return new Response(JSON.stringify({ id: "vid1" }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const { s, finish } = store([row()]);
    const rep = await runPublish(s, { ...baseEnv, YOUTUBE_PLAYLIST_ID: "PL1" } as unknown as NodeJS.ProcessEnv, f);
    expect(rep.outcomes).toEqual([{ id: "r1", platform: "youtube", result: "published" }]);
    const meta = JSON.parse(String(calls.find((c) => c.url.includes("uploadType=resumable"))!.init!.body));
    expect(meta.status).toMatchObject({ privacyStatus: "private", containsSyntheticMedia: true });
    expect(calls.some((c) => c.url.includes("playlistItems"))).toBe(true);
    expect(finish).toHaveBeenCalledWith("r1", expect.objectContaining({ status: "published", external_id: "vid1" }));
  });

  it("never goes public without both the row's public approval and SOCIAL_ALLOW_PUBLIC", async () => {
    const seen: string[] = [];
    const adapters = { ...ADAPTERS, youtube: { ...youtube, publish: async (j: { visibility: string }) => { seen.push(j.visibility); return { externalId: "x", url: null }; } } } as unknown as typeof ADAPTERS;
    await runPublish(store([row({ visibility: "public" })]).s, baseEnv, fetch, adapters);
    await runPublish(store([row({ visibility: "public" })]).s, { ...baseEnv, SOCIAL_ALLOW_PUBLIC: "1" } as unknown as NodeJS.ProcessEnv, fetch, adapters);
    expect(seen).toEqual(["private", "public"]);
  });

  it("holds without an account, retries transient errors, fails permanent ones, respects perRun", async () => {
    const noAcct = await runPublish(store([row()], { account: async () => null }).s, baseEnv);
    expect(noAcct.outcomes[0]).toMatchObject({ result: "held", detail: "account not connected" });

    const boom = (permanent: boolean) => ({ ...ADAPTERS, youtube: { ...youtube, publish: async () => { throw new (await import("../lib/social/platforms/types")).PlatformError("nope", permanent); } } }) as unknown as typeof ADAPTERS;
    const a = store([row()]);
    expect((await runPublish(a.s, baseEnv, fetch, boom(false))).outcomes[0]!.result).toBe("retry");
    expect(a.finish).toHaveBeenCalledWith("r1", expect.objectContaining({ status: "approved", attempts: 1 }));
    const b = store([row()]);
    expect((await runPublish(b.s, baseEnv, fetch, boom(true))).outcomes[0]!.result).toBe("failed");

    const two = store([row({ id: "a" }), row({ id: "b" })]);
    const ok = { ...ADAPTERS, youtube: { ...youtube, publish: async () => ({ externalId: "x", url: null }) } } as unknown as typeof ADAPTERS;
    expect((await runPublish(two.s, baseEnv, fetch, ok)).outcomes).toHaveLength(1);
  });

  it("skips a row another run already claimed", async () => {
    const { s, finish } = store([row()], { claim: async () => false });
    expect((await runPublish(s, baseEnv)).outcomes).toEqual([]);
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("adapters", () => {
  it("TikTok marks content AI-generated and stays self-only unless public is offered and allowed", async () => {
    let init: Record<string, unknown> = {};
    const f = vi.fn(async (u: string | URL | Request, o?: RequestInit) => {
      const url = String(u);
      if (url.includes("oauth/token")) return new Response(JSON.stringify({ access_token: "at" }));
      if (url.includes("creator_info")) return new Response(JSON.stringify({ data: { privacy_level_options: ["SELF_ONLY"] } }));
      if (url.includes("video/init")) { init = JSON.parse(String(o!.body)); return new Response(JSON.stringify({ data: { publish_id: "p1", upload_url: "https://up/1" } })); }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await tiktok.publish({ title: "t", caption: "c", visibility: "public", videoUrl: "u", loadBytes: async () => new Uint8Array(4) }, { secret: "r", extra: {} }, {} as NodeJS.ProcessEnv, f);
    expect(res.externalId).toBe("p1");
    expect((init.post_info as Record<string, unknown>)).toMatchObject({ is_aigc: true, privacy_level: "SELF_ONLY" });
  });

  it("Facebook reel goes start -> hosted upload -> finish as PUBLISHED", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ video_id: "v9", upload_url: "https://rupload/9" }));
    }) as unknown as typeof fetch;
    const r = await facebookAdapter.publish({ title: "t", caption: "c", visibility: "public", videoUrl: "https://s/v.mp4", loadBytes: async () => new Uint8Array() }, { secret: "pt", extra: { page_id: "P" } }, {} as NodeJS.ProcessEnv, f);
    expect(r.externalId).toBe("v9");
    expect(urls).toEqual(["https://graph.facebook.com/v21.0/P/video_reels", "https://rupload/9", "https://graph.facebook.com/v21.0/P/video_reels"]);
  });
});
