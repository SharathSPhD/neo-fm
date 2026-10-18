import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { readState, signState, verifyState } from "../lib/social/crypto";
import { canUseOwnApp, envWithApp, listenerSocialEnabled, shareRoute } from "../lib/social/listener/config";
import { shareTargets } from "../lib/social/listener/share-links";
import { listConnections, saveOwnApp, loadOwnApp } from "../lib/social/listener/store";
import { youtube } from "../lib/social/platforms/youtube";

const key = randomBytes(32).toString("base64");

describe("listener social config", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(listenerSocialEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(listenerSocialEnabled({ LISTENER_SOCIAL_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(listenerSocialEnabled({ LISTENER_SOCIAL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("lets only paid tiers bring their own app", () => {
    expect(canUseOwnApp("free")).toBe(false);
    expect(canUseOwnApp(null)).toBe(false);
    expect(canUseOwnApp("creator")).toBe(true);
    expect(canUseOwnApp("pro")).toBe(true);
  });
  it("defaults to private API for youtube/tiktok and the share sheet for Meta until reviewed", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(shareRoute("youtube", env)).toBe("api_private");
    expect(shareRoute("tiktok", env)).toBe("api_private");
    expect(shareRoute("instagram", env)).toBe("share_sheet");
    expect(shareRoute("instagram", { LISTENER_SOCIAL_REVIEWED: "instagram" } as unknown as NodeJS.ProcessEnv)).toBe("api");
  });
  it("swaps a listener's own app credentials into the env the adapter reads", () => {
    const env = envWithApp({ YOUTUBE_CLIENT_ID: "shared" } as unknown as NodeJS.ProcessEnv, "youtube", "mine", "s3cret");
    const url = new URL(youtube.authUrl("st", "https://x/cb", env));
    expect(url.searchParams.get("client_id")).toBe("mine");
  });
});

describe("state", () => {
  it("round-trips the user and mode, and still verifies for the admin flow", () => {
    const st = signState("youtube", "k", Date.now(), 60_000, { u: "user-1", m: "own_app" });
    expect(readState(st, "youtube", "k")).toEqual({ u: "user-1", m: "own_app" });
    expect(verifyState(signState("youtube", "k"), "youtube", "k")).toBe(true);
  });
  it("rejects a wrong platform, secret, tamper and expiry", () => {
    const st = signState("youtube", "k", 1000, 60_000, { u: "user-1" });
    expect(readState(st, "tiktok", "k", 2000)).toBeNull();
    expect(readState(st, "youtube", "other", 2000)).toBeNull();
    expect(readState(st, "youtube", "k", 1000 + 60_001)).toBeNull();
    const [p, sig] = st.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "victim", p: "youtube", e: 9e15 })).toString("base64url");
    expect(readState(`${forged}.${sig}`, "youtube", "k", 2000)).toBeNull();
    expect(p).toBeTruthy();
  });
});

describe("share links", () => {
  it("builds WhatsApp and Facebook intents and copy-then-open for the rest", () => {
    const t = shareTargets("https://neo.fm/s/abc", "Listen & enjoy");
    const by = Object.fromEntries(t.map((x) => [x.platform, x])) as Record<string, (typeof t)[number] & {}>;
    const get = (n: string) => by[n]!;
    expect(get("whatsapp").href).toContain("wa.me");
    expect(decodeURIComponent(get("whatsapp").href ?? "")).toContain("https://neo.fm/s/abc");
    expect(get("facebook").href).toContain("sharer.php");
    expect(get("instagram").copyThenOpen && get("tiktok").copyThenOpen && get("youtube").copyThenOpen).toBe(true);
  });
});

describe("store", () => {
  it("reports unavailable when the migration is not applied", async () => {
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: "42P01", message: "x" } }) }) }) };
    expect(await listConnections(db as never, "u")).toBe("unavailable");
  });
  it("seals own-app credentials before they reach the database and opens them back", async () => {
    const env = { SOCIAL_TOKEN_KEY: key } as unknown as NodeJS.ProcessEnv;
    let row: Record<string, string> = {};
    const db = {
      from: () => ({
        upsert: async (r: Record<string, string>) => { row = r; return { error: null }; },
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
      }),
    };
    expect(await saveOwnApp(db as never, "u", "youtube", "my-id", "my-secret", env)).toBe(true);
    expect(JSON.stringify(row)).not.toContain("my-secret");
    expect(await loadOwnApp(db as never, "u", "youtube", env)).toEqual({ clientId: "my-id", clientSecret: "my-secret" });
  });
});
