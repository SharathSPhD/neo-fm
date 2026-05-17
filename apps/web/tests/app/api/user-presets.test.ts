/**
 * v1.4 Sprint 4 — Tests for the `user_presets` CRUD API.
 *
 *   GET    /api/user-presets        list under RLS
 *   POST   /api/user-presets        save_user_preset RPC
 *   DELETE /api/user-presets/[id]   delete_user_preset RPC
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  POST,
} from "../../../app/api/user-presets/route";
import { DELETE } from "../../../app/api/user-presets/[id]/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod =
    await vi.importActual<typeof import("../../../lib/supabase/auth")>(
      "../../../lib/supabase/auth",
    );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PRESET_ID = "11111111-1111-1111-1111-111111111111";

function authed(s: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: s as never,
  });
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});

const VALID_DOC = {
  language: "en" as const,
  style_family: "western" as const,
  target_duration_seconds: 90 as const,
  sections: [{ id: "s1", type: "verse" as const, target_seconds: 90 }],
};

describe("GET /api/user-presets", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the user's presets", async () => {
    const s = makeFakeSupabase();
    authed(s);
    s.__state.select_lists.user_presets = [
      { id: PRESET_ID, title: "Yaman", style_family: "hindustani" },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets[0]).toMatchObject({ id: PRESET_ID });
  });
});

describe("POST /api/user-presets", () => {
  it("400 on malformed JSON", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("422 when the document fails validation", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X", song_document: { language: "en" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("201 + id on success, RPC called with title + doc", async () => {
    const s = makeFakeSupabase();
    authed(s);
    s.__state.rpc_handlers.save_user_preset = () => ({
      data: [{ id: PRESET_ID, created_at: "2026-05-17T13:00:00Z" }],
      error: null,
    });
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Morning Saveri",
        song_document: VALID_DOC,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: PRESET_ID, title: "Morning Saveri" });
    const call = s.__state.rpc_calls.find((c) => c.name === "save_user_preset");
    expect(call).toBeDefined();
    expect((call!.args as { p_title: string }).p_title).toBe("Morning Saveri");
  });

  it("409 when the RPC raises too_many_presets (sqlstate 23505)", async () => {
    const s = makeFakeSupabase();
    authed(s);
    s.__state.rpc_handlers.save_user_preset = () => ({
      data: null,
      error: { message: "too_many_presets", code: "23505" } as never,
    });
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X", song_document: VALID_DOC }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "too_many_presets", limit: 20 });
  });
});

describe("DELETE /api/user-presets/[id]", () => {
  it("400 on invalid id", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await DELETE(new Request("http://localhost/"), {
      params: { id: "bad" },
    });
    expect(res.status).toBe(400);
  });

  it("404 when the RPC reports preset_not_found (42704)", async () => {
    const s = makeFakeSupabase();
    authed(s);
    s.__state.rpc_handlers.delete_user_preset = () => ({
      data: null,
      error: { message: "preset_not_found", code: "42704" } as never,
    });
    const res = await DELETE(new Request("http://localhost/"), {
      params: { id: PRESET_ID },
    });
    expect(res.status).toBe(404);
  });

  it("200 with id on successful delete", async () => {
    const s = makeFakeSupabase();
    authed(s);
    s.__state.rpc_handlers.delete_user_preset = () => ({
      data: null,
      error: null,
    });
    const res = await DELETE(new Request("http://localhost/"), {
      params: { id: PRESET_ID },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: PRESET_ID, deleted: true });
  });
});
