/** like / follow / rename / handle: thin RPC routes. Pin id validation, auth, and RPC error -> status mapping. */
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as like } from "../../../app/api/songs/[id]/like/route";
import { POST as follow } from "../../../app/api/users/[id]/follow/route";
import { POST as rename } from "../../../app/api/songs/[id]/rename/route";
import { POST as claimHandle } from "../../../app/api/account/handle/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>("../../../lib/supabase/auth");
  return { ...mod, requireUser: vi.fn() };
});
import { requireUser } from "../../../lib/supabase/auth";

const ID = "11111111-1111-1111-1111-111111111111";
const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const authed = (s: FakeSupabase) => vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } as never, supabase: s as never });
const anon = () => vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
const rpcError = (s: FakeSupabase, name: string, error: { message: string; code?: string }) => { s.__state.rpc_handlers[name] = () => ({ data: null, error }); };

beforeEach(() => vi.mocked(requireUser).mockReset());
afterEach(() => vi.clearAllMocks());

describe("POST /api/songs/[id]/like", () => {
  it("rejects a non-uuid id before touching auth", async () => {
    expect((await like(new Request("http://x"), { params: { id: "nope" } })).status).toBe(400);
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("401s when signed out", async () => {
    anon();
    expect((await like(new Request("http://x"), { params: { id: ID } })).status).toBe(401);
  });
  it("returns the toggled state", async () => {
    const s = makeFakeSupabase(); authed(s);
    s.__state.rpc_handlers.toggle_like = () => ({ data: [{ is_liked: true, like_count: 4 }], error: null });
    const res = await like(new Request("http://x"), { params: { id: ID } });
    expect(await res.json()).toEqual({ is_liked: true, like_count: 4 });
    expect(s.__state.rpc_calls[0]).toEqual({ name: "toggle_like", args: { p_job_id: ID } });
  });
  it("maps RPC permission errors to 401 and others to 500", async () => {
    const s = makeFakeSupabase(); authed(s);
    rpcError(s, "toggle_like", { message: "denied", code: "42501" });
    expect((await like(new Request("http://x"), { params: { id: ID } })).status).toBe(401);
    rpcError(s, "toggle_like", { message: "boom" });
    expect((await like(new Request("http://x"), { params: { id: ID } })).status).toBe(500);
  });
});

describe("POST /api/users/[id]/follow", () => {
  it("validates the id and requires a session", async () => {
    expect((await follow(new Request("http://x"), { params: { id: "x" } })).status).toBe(400);
    anon();
    expect((await follow(new Request("http://x"), { params: { id: ID } })).status).toBe(401);
  });
  it("returns follow state and refuses self-follow with 400", async () => {
    const s = makeFakeSupabase(); authed(s);
    s.__state.rpc_handlers.toggle_follow = () => ({ data: [{ is_following: true, follower_count: 9 }], error: null });
    expect(await (await follow(new Request("http://x"), { params: { id: ID } })).json()).toEqual({ is_following: true, follower_count: 9 });
    rpcError(s, "toggle_follow", { message: "cannot_follow_self" });
    const res = await follow(new Request("http://x"), { params: { id: ID } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("cannot_follow_self");
  });
  it("maps 42501 to 401 and anything else to 500", async () => {
    const s = makeFakeSupabase(); authed(s);
    rpcError(s, "toggle_follow", { message: "x", code: "42501" });
    expect((await follow(new Request("http://x"), { params: { id: ID } })).status).toBe(401);
    rpcError(s, "toggle_follow", { message: "boom" });
    expect((await follow(new Request("http://x"), { params: { id: ID } })).status).toBe(500);
  });
});

describe("POST /api/songs/[id]/rename", () => {
  it("rejects bad ids, bad json and bad titles without calling the RPC", async () => {
    const s = makeFakeSupabase(); authed(s);
    expect((await rename(json({ title: "x" }), { params: { id: "bad" } })).status).toBe(400);
    expect((await rename(new Request("http://x", { method: "POST", body: "{" }), { params: { id: ID } })).status).toBe(400);
    expect((await rename(json({ title: "" }), { params: { id: ID } })).status).toBe(400);
    expect((await rename(json({}), { params: { id: ID } })).status).toBe(400);
    expect(s.__state.rpc_calls).toHaveLength(0);
  });
  it("401s when signed out and renames when signed in", async () => {
    anon();
    expect((await rename(json({ title: "Monsoon" }), { params: { id: ID } })).status).toBe(401);
    const s = makeFakeSupabase(); authed(s);
    s.__state.rpc_handlers.rename_song = () => ({ data: [{ title: "Monsoon" }], error: null });
    const res = await rename(json({ title: "Monsoon" }), { params: { id: ID } });
    expect(await res.json()).toEqual({ id: ID, title: "Monsoon" });
  });
  it("maps 42501 to 403 (not the owner), 22023 to 400, other errors to 500", async () => {
    const s = makeFakeSupabase(); authed(s);
    rpcError(s, "rename_song", { message: "x", code: "42501" });
    expect((await rename(json({ title: "A" }), { params: { id: ID } })).status).toBe(403);
    rpcError(s, "rename_song", { message: "x", code: "22023" });
    expect((await rename(json({ title: "A" }), { params: { id: ID } })).status).toBe(400);
    rpcError(s, "rename_song", { message: "x" });
    expect((await rename(json({ title: "A" }), { params: { id: ID } })).status).toBe(500);
  });
});

describe("POST /api/account/handle", () => {
  const req = (b: unknown) => json(b) as never;
  it("validates the handle shape before auth", async () => {
    for (const handle of ["ab", "a".repeat(31), "has space", "emoji😀x", undefined]) {
      expect((await claimHandle(req({ handle }))).status).toBe(400);
    }
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("401s when signed out; lower-cases the handle it claims", async () => {
    anon();
    expect((await claimHandle(req({ handle: "Maya_01" }))).status).toBe(401);
    const s = makeFakeSupabase(); authed(s);
    s.__state.rpc_handlers.claim_handle = () => ({ data: [{ handle: "maya_01" }], error: null });
    const res = await claimHandle(req({ handle: "Maya_01" }));
    expect(await res.json()).toEqual({ handle: "maya_01" });
    expect(s.__state.rpc_calls[0]).toEqual({ name: "claim_handle", args: { p_handle: "maya_01" } });
  });
  it.each([
    ["handle_taken", 409], ["handle_reserved", 400], ["handle_too_short", 400], ["handle_too_long", 400], ["handle_bad_chars", 400], ["db exploded", 500],
  ])("maps %s to %i", async (message, status) => {
    const s = makeFakeSupabase(); authed(s);
    rpcError(s, "claim_handle", { message });
    expect((await claimHandle(req({ handle: "maya_01" }))).status).toBe(status);
  });
});
