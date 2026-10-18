import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signState } from "../lib/social/crypto";

const exchange = vi.fn();
const requireUser = vi.fn();
vi.mock("../lib/supabase/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("../lib/agent/adapters", () => ({ serviceClient: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }) }));
vi.mock("../lib/social/platforms", () => ({ ADAPTERS: { youtube: { exchange: (...a: unknown[]) => exchange(...a) } } }));

import { GET } from "../app/api/social/callback/[platform]/route";

const call = (state: string) =>
  GET(new NextRequest(`https://x.test/api/social/callback/youtube?code=c&state=${encodeURIComponent(state)}`), { params: Promise.resolve({ platform: "youtube" }) });

describe("listener callback", () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = "adm";
    process.env.LISTENER_SOCIAL_ENABLED = "1";
    process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 1).toString("base64");
    exchange.mockReset().mockResolvedValue({ label: "Chan", secret: "r", extra: {} });
    requireUser.mockReset();
  });
  it("rejects when the signed-in user is not the one who started the connect", async () => {
    requireUser.mockResolvedValue({ user: { id: "attacker" } });
    const r = await call(signState("youtube", "adm", Date.now(), 60_000, { u: "victim", m: "neofm_app" }));
    expect(r.status).toBe(403);
    expect(exchange).not.toHaveBeenCalled();
  });
  it("rejects when nobody is signed in", async () => {
    requireUser.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const r = await call(signState("youtube", "adm", Date.now(), 60_000, { u: "victim" }));
    expect(r.status).toBe(403);
    expect(exchange).not.toHaveBeenCalled();
  });
  it("connects when the user matches", async () => {
    requireUser.mockResolvedValue({ user: { id: "victim" } });
    const r = await call(signState("youtube", "adm", Date.now(), 60_000, { u: "victim", m: "neofm_app" }));
    expect(r.status).toBe(200);
    expect(exchange).toHaveBeenCalledOnce();
  });
});
