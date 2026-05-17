/**
 * Tests for POST /api/songs/[id]/variation (v1.4 Sprint 3 contract).
 *
 * Coverage:
 *   - empty body still works (back-compat with v1.3 callers / prod-smoke)
 *   - 422 on malformed body / schema violation
 *   - tempo + title overrides reach `create_song_job` via the fork-applier
 *   - raga override that conflicts with style → 422
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/variation/route";
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
const PARENT_ID = "11111111-1111-1111-1111-111111111111";
const CHILD_ID = "22222222-2222-2222-2222-222222222222";

const PARENT_DOC = {
  language: "en",
  style_family: "western",
  tempo_bpm: 110,
  target_duration_seconds: 90,
  sections: [
    { id: "v1", type: "verse", target_seconds: 30 },
    { id: "c1", type: "chorus", target_seconds: 30 },
    { id: "v2", type: "verse", target_seconds: 30 },
  ],
} as const;

function authed(s: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: s as never,
  });
}

function seedParent(s: FakeSupabase) {
  s.__state.select_singles.jobs = {
    id: PARENT_ID,
    song_documents: {
      document_json: PARENT_DOC,
      language: "en",
      style_family: "western",
      title: "Streetlights",
    },
  };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});

function makeReq(body?: object): NextRequest {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

it("returns 401 when unauthenticated", async () => {
  vi.mocked(requireUser).mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  const res = await POST(makeReq(), { params: { id: PARENT_ID } });
  expect(res.status).toBe(401);
});

it("returns 400 for an invalid id", async () => {
  const s = makeFakeSupabase();
  authed(s);
  const res = await POST(makeReq(), { params: { id: "not-a-uuid" } });
  expect(res.status).toBe(400);
});

it("returns 422 for a malformed body (distance > 100)", async () => {
  const s = makeFakeSupabase();
  authed(s);
  seedParent(s);
  const res = await POST(makeReq({ distance: 9999 }), {
    params: { id: PARENT_ID },
  });
  expect(res.status).toBe(422);
});

describe("happy path", () => {
  it("accepts an empty body and re-runs the doc verbatim", async () => {
    const s = makeFakeSupabase();
    authed(s);
    seedParent(s);
    s.__state.rpc_handlers.create_song_job = () => ({
      data: [{ job_id: CHILD_ID, song_id: "doc-2", status: "queued" }],
      error: null,
    });
    const res = await POST(makeReq(), { params: { id: PARENT_ID } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ job_id: CHILD_ID, distance: 25 });
    const args = s.__state.rpc_calls.find(
      (c) => c.name === "create_song_job",
    )!.args as {
      p_song_document: {
        tempo_bpm: number;
        target_duration_seconds: number;
        metadata: { fork: { kind: string; distance: number } };
      };
    };
    // Variation never jitters; tempo is preserved verbatim.
    expect(args.p_song_document.tempo_bpm).toBe(110);
    expect(args.p_song_document.metadata.fork).toMatchObject({
      kind: "variation",
      distance: 25,
    });
  });

  it("applies tempo and title overrides", async () => {
    const s = makeFakeSupabase();
    authed(s);
    seedParent(s);
    s.__state.rpc_handlers.create_song_job = () => ({
      data: [{ job_id: CHILD_ID, song_id: "doc-2", status: "queued" }],
      error: null,
    });
    const res = await POST(
      makeReq({ tempo_bpm: 140, title: "Streetlights at noon", distance: 80 }),
      { params: { id: PARENT_ID } },
    );
    expect(res.status).toBe(202);
    const args = s.__state.rpc_calls.find(
      (c) => c.name === "create_song_job",
    )!.args as {
      p_song_document: { tempo_bpm: number; title: string };
    };
    expect(args.p_song_document.tempo_bpm).toBe(140);
    expect(args.p_song_document.title).toBe("Streetlights at noon");
  });

  it("rejects a raga override that doesn't fit the style (422)", async () => {
    const s = makeFakeSupabase();
    authed(s);
    seedParent(s);
    const res = await POST(
      makeReq({
        raga_override: { name: "yaman", system: "hindustani" },
      }),
      { params: { id: PARENT_ID } },
    );
    expect(res.status).toBe(422);
  });
});
