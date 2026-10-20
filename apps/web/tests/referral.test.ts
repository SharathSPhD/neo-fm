import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { withShareUtm } from "@/lib/share/attribution";
import { clipBrandLine, cleanRef } from "@/lib/share/referral";

const upsert = vi.fn();
let profiles: { id: string; handle: string | null }[] = [];
let user: { id: string; created_at: string } | NextResponse = { id: "me", created_at: new Date().toISOString() };

vi.mock("../lib/supabase/auth", () => ({ requireUser: async () => (user instanceof NextResponse ? user : { user, supabase: {} }) }));
vi.mock("../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: (t: string) =>
      t === "public_profiles"
        ? { select: () => ({ ilike: () => ({ limit: async () => ({ data: profiles }) }) }) }
        : { upsert },
  }),
}));

import { POST } from "../app/api/referral/claim/route";

const post = (body: unknown) =>
  POST(new Request("https://x/api/referral/claim", { method: "POST", body: JSON.stringify(body) }) as never);

describe("cleanRef", () => {
  it("accepts public handles only", () => {
    expect(cleanRef("@Asha_k")).toBe("asha_k");
    expect(cleanRef("ab")).toBeNull();
    expect(cleanRef("a b c")).toBeNull();
    expect(cleanRef("someone@example.com")).toBeNull();
    expect(cleanRef("x".repeat(31))).toBeNull();
    expect(cleanRef(42)).toBeNull();
  });
  it("puts the handle on the clip brand line and falls back without one", () => {
    expect(clipBrandLine("asha_k")).toBe("@asha_k · neo.fm · AI-generated");
    expect(clipBrandLine(null)).toBe("neo.fm · AI-generated");
    expect(clipBrandLine("not a handle!")).toBe("neo.fm · AI-generated");
  });
});

describe("withShareUtm ref", () => {
  it("adds a valid handle and drops an invalid or missing one", () => {
    expect(withShareUtm("https://x.test/s/a", "copy", "song", "asha_k")).toContain("&ref=asha_k");
    expect(withShareUtm("https://x.test/s/a?ref=old", "copy", "song")).not.toContain("ref=");
    expect(withShareUtm("https://x.test/s/a", "copy", "song", "a@b.co")).not.toContain("ref=");
  });
});

describe("POST /api/referral/claim", () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
    profiles = [{ id: "sharer", handle: "Asha_k" }];
    user = { id: "me", created_at: new Date().toISOString() };
  });

  it("records the first claim for a new account, with the share channel", async () => {
    const res = await post({ ref: "asha_k", utm: { source: "whatsapp", medium: "share", campaign: "share-song" } });
    expect(res.status).toBe(204);
    expect(upsert).toHaveBeenCalledWith({ referee_id: "me", referrer_id: "sharer", source: "whatsapp" }, { onConflict: "referee_id", ignoreDuplicates: true });
  });

  it("ignores self-claims, unknown handles, wildcard look-alikes and invalid refs", async () => {
    profiles = [{ id: "me", handle: "asha_k" }];
    await post({ ref: "asha_k" });
    profiles = [{ id: "other", handle: "ashaxk" }];
    await post({ ref: "asha_k" });
    profiles = [];
    await post({ ref: "asha_k" });
    await post({ ref: "bad handle" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ignores accounts older than a week", async () => {
    user = { id: "me", created_at: new Date(Date.now() - 8 * 86_400_000).toISOString() };
    expect((await post({ ref: "asha_k" })).status).toBe(204);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("still answers 204 when the table is missing", async () => {
    upsert.mockRejectedValue(new Error("relation does not exist"));
    expect((await post({ ref: "asha_k" })).status).toBe(204);
  });

  it("requires a signed-in user", async () => {
    user = NextResponse.json({ error: "unauthorized" }, { status: 401 });
    expect((await post({ ref: "asha_k" })).status).toBe(401);
  });
});
