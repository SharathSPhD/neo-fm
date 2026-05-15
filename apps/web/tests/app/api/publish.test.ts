/**
 * Tests for POST /api/songs/[id]/publish (M1, ADR 0013).
 *
 * Delegates to the `publish_song` Postgres RPC. The route is responsible for:
 *   - rejecting unauthenticated callers
 *   - validating the URL id and request body
 *   - translating SQLSTATEs from publish_song into HTTP status codes:
 *       42501 (insufficient privilege) -> 403
 *       P0002 (no_data_found)          -> 404
 *       22023 (invalid_parameter)      -> 422
 *       <other>                        -> 500
 *   - composing an absolute public URL from NEXT_PUBLIC_SITE_URL /
 *     VERCEL_PROJECT_PRODUCTION_URL / request host.
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/publish/route";
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

function authed(supabase: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: supabase as never,
  });
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

it("returns 401 when unauthenticated", async () => {
  vi.mocked(requireUser).mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  const req = new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "unlisted" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(401);
});

it("returns 400 for invalid song id", async () => {
  const s = makeFakeSupabase();
  authed(s);
  const req = new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "unlisted" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: "not-a-uuid" } });
  expect(res.status).toBe(400);
});

it("returns 400 for invalid body", async () => {
  const s = makeFakeSupabase();
  authed(s);
  const req = new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "world-readable" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(400);
});

it("happy path: returns public_id, visibility, public_url", async () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.publish_song = () => ({
    data: [
      {
        public_id: "abc123pqrs",
        visibility: "unlisted",
        published_at: "2026-05-15T22:00:00Z",
      },
    ],
    error: null,
  });
  authed(s);
  const req = new NextRequest("http://example.test/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "unlisted" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.public_id).toBe("abc123pqrs");
  expect(body.visibility).toBe("unlisted");
  expect(body.public_url).toBe("https://example.test/s/abc123pqrs");
});

it("private visibility returns null public_url", async () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.publish_song = () => ({
    data: [
      {
        public_id: "abc123pqrs",
        visibility: "private",
        published_at: null,
      },
    ],
    error: null,
  });
  authed(s);
  const req = new NextRequest("http://example.test/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "private" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.visibility).toBe("private");
  expect(body.public_url).toBeNull();
});

it("translates SQLSTATE 42501 -> 403", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.publish_song = () => ({
    data: null,
    error: { message: "forbidden", code: "42501" } as never,
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "public" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(403);
});

it("translates SQLSTATE P0002 -> 404", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.publish_song = () => ({
    data: null,
    error: { message: "song not found", code: "P0002" } as never,
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "public" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(404);
});

it("translates SQLSTATE 22023 (not completed) -> 422", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.publish_song = () => ({
    data: null,
    error: {
      message: "song is not completed (status=queued)",
      code: "22023",
    } as never,
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify({ visibility: "public" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: { id: SONG_ID } });
  expect(res.status).toBe(422);
});
