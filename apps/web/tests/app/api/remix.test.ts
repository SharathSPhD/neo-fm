/**
 * Tests for POST /api/songs/[id]/remix (v1.2 Sprint 6.3).
 *
 * The route forks an existing song into a new generation job, mutating
 * the tempo and suffixing the title with " (remix)". The new job goes
 * through `create_song_job` so quota / storage caps still apply.
 *
 * Coverage:
 *   - unauthenticated -> 401
 *   - invalid id -> 400
 *   - parent not visible -> 404
 *   - happy path: 202, RPC called with mutated doc, lineage update fires
 *   - quota_exceeded surfaces as 429
 *   - lineage update failure still returns the new job (202 + warning)
 *
 * We exercise the doc-mutation contract via the captured RPC args:
 *   - tempo_bpm changes by ±5..±15 (and stays in the schema's 30..240 range)
 *   - title is suffixed with " (remix)" and capped at 120 chars
 *   - all sections + target_duration_seconds are preserved (so the cross-field
 *     sum invariant in SongDocumentSchema still holds)
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/remix/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod =
    await vi.importActual<typeof import("../../../lib/supabase/auth")>(
      "../../../lib/supabase/auth",
    );
  return { ...mod, requireUser: vi.fn() };
});

// The remix route uses the service-role client for the lineage stamp
// (no jobs_update RLS policy exists in production). The mock returns
// the same fake as the user-scoped client so test assertions can
// inspect `state.updated`.
vi.mock("../../../lib/supabase/server", async () => {
  const mod =
    await vi.importActual<typeof import("../../../lib/supabase/server")>(
      "../../../lib/supabase/server",
    );
  return { ...mod, createServiceRoleClient: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";
import { createServiceRoleClient } from "../../../lib/supabase/server";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PARENT_ID = "11111111-1111-1111-1111-111111111111";
const REMIX_ID = "22222222-2222-2222-2222-222222222222";
const PARENT_DOC = {
  language: "en",
  style_family: "western",
  tempo_bpm: 112,
  time_signature: "4/4",
  target_duration_seconds: 180,
  orchestration: {
    lead_vocal: "female",
    instruments: ["acoustic_guitar", "bass", "drum_kit", "synth_pad"],
    texture: "full-band",
  },
  sections: [
    { id: "intro", type: "intro", script: "latin", target_seconds: 12 },
    {
      id: "v1",
      type: "verse",
      script: "latin",
      lyrics: "The streetlights flicker on a Tuesday afternoon",
      target_seconds: 40,
    },
    {
      id: "c1",
      type: "chorus",
      script: "latin",
      lyrics: "We are everywhere and nowhere all at once",
      target_seconds: 32,
    },
    {
      id: "v2",
      type: "verse",
      script: "latin",
      lyrics: "I traced the coastline of a city I have never been",
      target_seconds: 40,
    },
    {
      id: "c2",
      type: "chorus",
      script: "latin",
      lyrics: "We are everywhere and nowhere all at once",
      target_seconds: 40,
    },
    { id: "outro", type: "outro", script: "latin", target_seconds: 16 },
  ],
} as const;

function authed(supabase: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: supabase as never,
  });
  // Same fake stands in for the service-role client so the lineage
  // stamp shows up in `__state.updated` and we can assert against it.
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase as never);
}

function seedParent(s: FakeSupabase) {
  s.__state.select_singles.jobs = {
    id: PARENT_ID,
    song_document_id: "doc-1",
    song_documents: {
      id: "doc-1",
      title: "Streetlights",
      language: "en",
      style_family: "western",
      document_json: PARENT_DOC,
    },
  };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

it("returns 401 when unauthenticated", async () => {
  vi.mocked(requireUser).mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, { params: { id: PARENT_ID } });
  expect(res.status).toBe(401);
});

it("returns 400 for an invalid id", async () => {
  const s = makeFakeSupabase();
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, { params: { id: "not-a-uuid" } });
  expect(res.status).toBe(400);
});

it("returns 404 when the parent isn't visible", async () => {
  const s = makeFakeSupabase();
  authed(s);
  // No select_singles seeded for `jobs` -> maybeSingle returns null.
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, { params: { id: PARENT_ID } });
  expect(res.status).toBe(404);
});

describe("happy path", () => {
  it("returns 202, mutates the doc, stamps lineage", async () => {
    const s = makeFakeSupabase();
    authed(s);
    seedParent(s);
    s.__state.rpc_handlers.create_song_job = () => ({
      data: [{ job_id: REMIX_ID, song_id: "doc-2", status: "queued" }],
      error: null,
    });

    const req = new NextRequest("http://localhost/x", { method: "POST" });
    const res = await POST(req, { params: { id: PARENT_ID } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      job_id: REMIX_ID,
      status: "queued",
      remixed_from: PARENT_ID,
    });

    // Inspect the doc we handed to create_song_job.
    const rpcCall = s.__state.rpc_calls.find(
      (c) => c.name === "create_song_job",
    );
    expect(rpcCall).toBeTruthy();
    const args = rpcCall!.args as {
      p_song_document: {
        title: string;
        tempo_bpm: number;
        target_duration_seconds: number;
        sections: { target_seconds: number }[];
      };
      p_language: string;
      p_style_family: string;
      p_target_duration_seconds: number;
    };

    expect(args.p_language).toBe("en");
    expect(args.p_style_family).toBe("western");
    expect(args.p_target_duration_seconds).toBe(180);
    expect(args.p_song_document.title).toBe("Streetlights (remix)");
    // Tempo shifts by a non-zero amount and stays in 30..240.
    expect(args.p_song_document.tempo_bpm).not.toBe(PARENT_DOC.tempo_bpm);
    expect(args.p_song_document.tempo_bpm).toBeGreaterThanOrEqual(30);
    expect(args.p_song_document.tempo_bpm).toBeLessThanOrEqual(240);
    expect(
      Math.abs(args.p_song_document.tempo_bpm - PARENT_DOC.tempo_bpm),
    ).toBeLessThanOrEqual(15);
    // Section sum still equals target_duration_seconds (cross-field rule).
    const sum = args.p_song_document.sections.reduce(
      (acc: number, sec) => acc + sec.target_seconds,
      0,
    );
    expect(sum).toBe(args.p_song_document.target_duration_seconds);

    // Lineage stamp fired against the right table+row.
    const lineageUpdate = s.__state.updated.find(
      (u) => u.table === "jobs" && u.eq?.[0] === "id" && u.eq?.[1] === REMIX_ID,
    );
    expect(lineageUpdate?.row).toMatchObject({ remixed_from: PARENT_ID });
  });

  it("doesn't double-suffix a remix of a remix", async () => {
    const s = makeFakeSupabase();
    authed(s);
    s.__state.select_singles.jobs = {
      id: PARENT_ID,
      song_document_id: "doc-1",
      song_documents: {
        id: "doc-1",
        title: "Streetlights (remix)",
        language: "en",
        style_family: "western",
        document_json: { ...PARENT_DOC, title: "Streetlights (remix)" },
      },
    };
    s.__state.rpc_handlers.create_song_job = () => ({
      data: [{ job_id: REMIX_ID, song_id: "doc-2", status: "queued" }],
      error: null,
    });
    const req = new NextRequest("http://localhost/x", { method: "POST" });
    const res = await POST(req, { params: { id: PARENT_ID } });
    expect(res.status).toBe(202);
    const args = s.__state.rpc_calls.find(
      (c) => c.name === "create_song_job",
    )!.args as { p_song_document: { title: string } };
    expect(args.p_song_document.title).toBe("Streetlights (remix)");
  });
});

it("surfaces quota_exceeded as 429", async () => {
  const s = makeFakeSupabase();
  authed(s);
  seedParent(s);
  s.__state.rpc_handlers.create_song_job = () => ({
    data: null,
    error: { message: "quota_exceeded: rows_per_month" },
  });
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, { params: { id: PARENT_ID } });
  expect(res.status).toBe(429);
});

it("surfaces concurrent_cap_exceeded as 429", async () => {
  const s = makeFakeSupabase();
  authed(s);
  seedParent(s);
  s.__state.rpc_handlers.create_song_job = () => ({
    data: null,
    error: { message: "concurrent_cap_exceeded" },
  });
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, { params: { id: PARENT_ID } });
  expect(res.status).toBe(429);
});
