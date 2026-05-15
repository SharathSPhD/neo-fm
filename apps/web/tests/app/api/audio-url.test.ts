/**
 * Tests for GET /api/songs/[id]/audio-url (ADR 0012 Tier 2 refresh).
 *
 *   - unauthenticated -> 401
 *   - invalid id -> 400
 *   - maybeSingle returns null (RLS-hidden / non-existent) -> 404
 *   - row exists but status != completed -> 404 with no_track shape
 *   - happy path: mints a signed URL, returns 200 with no-store cache
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../../app/api/songs/[id]/audio-url/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const SONG_ID = "11111111-1111-1111-1111-111111111111";

function authed(s: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: s as never,
  });
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

it("returns 401 when unauthenticated", async () => {
  vi.mocked(requireUser).mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  const req = new NextRequest("http://localhost/x");
  const res = await GET(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(401);
});

it("returns 400 for invalid id", async () => {
  const s = makeFakeSupabase();
  authed(s);
  const req = new NextRequest("http://localhost/x");
  const res = await GET(req, { params: { id: "not-a-uuid" } });
  expect(res.status).toBe(400);
});

it("returns 404 when RLS hides the row", async () => {
  const s = makeFakeSupabase();
  // jobs maybeSingle returns null by default.
  authed(s);
  const req = new NextRequest("http://localhost/x");
  const res = await GET(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(404);
});

it("returns 404 with no_track when row exists but status is processing", async () => {
  const s = makeFakeSupabase();
  s.__state.select_singles.jobs = {
    id: SONG_ID,
    status: "processing",
    tracks: [],
  };
  authed(s);
  const req = new NextRequest("http://localhost/x");
  const res = await GET(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string; status?: string };
  expect(body.error).toBe("no_track");
  expect(body.status).toBe("processing");
});

it("happy path: returns a signed URL with no-store cache control", async () => {
  const s = makeFakeSupabase();
  s.__state.select_singles.jobs = {
    id: SONG_ID,
    status: "completed",
    tracks: [
      {
        id: "tr-1",
        url: `tracks/${SONG_ID}/attempt.wav`,
        duration_seconds: 30,
        format: "wav",
        bytes: 1024,
        created_at: "2026-05-15T00:00:00Z",
      },
    ],
  };
  s.__state.signed_url = "https://signed.example.com/refreshed.wav";
  authed(s);
  const req = new NextRequest("http://localhost/x");
  const res = await GET(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as {
    url: string;
    expires_in_seconds: number;
    format: string;
    duration_seconds: number | null;
  };
  expect(body.url).toBe("https://signed.example.com/refreshed.wav");
  expect(body.expires_in_seconds).toBeGreaterThan(0);
  expect(body.format).toBe("wav");
  expect(body.duration_seconds).toBe(30);
});
