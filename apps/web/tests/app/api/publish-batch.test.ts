/**
 * Tests for POST /api/songs/publish-batch (v1.4 Sprint 15).
 *
 * Delegates to the `publish_song_batch` Postgres RPC (migration 0040)
 * which enforces auth, ownership, the free-tier 5-public-songs cap,
 * and a 100-id batch ceiling. The route is responsible for:
 *   - rejecting unauthenticated callers
 *   - schema-validating the body (job_ids: uuid[1..100], visibility)
 *   - de-duplicating ids before calling the RPC
 *   - translating SQLSTATEs into HTTP codes
 *   - returning `{ outcomes, summary }` with HTTP 200 even when some
 *     rows fail individually
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/publish-batch/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

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
});

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/songs/publish-batch", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq({ job_ids: [A], visibility: "public" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body (missing job_ids)", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(makeReq({ visibility: "public" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body (visibility enum)", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(
      makeReq({ job_ids: [A], visibility: "world-readable" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body (non-uuid job_ids)", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(
      makeReq({ job_ids: ["not-a-uuid"], visibility: "public" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when batch exceeds 100 ids", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    const res = await POST(makeReq({ job_ids: ids, visibility: "public" }));
    expect(res.status).toBe(400);
  });

  it("happy path: all rows published, summary reflects per-row outcomes", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.publish_song_batch = () => ({
      data: [
        {
          job_id: A,
          public_id: "aaaaaaaaaa",
          visibility: "public",
          published_at: "2026-05-17T12:00:00Z",
          outcome: "published",
        },
        {
          job_id: B,
          public_id: "bbbbbbbbbb",
          visibility: "public",
          published_at: "2026-05-17T12:00:00Z",
          outcome: "published",
        },
      ],
      error: null,
    });
    authed(s);
    const res = await POST(
      makeReq({ job_ids: [A, B], visibility: "public" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcomes: { outcome: string }[];
      summary: Record<string, number>;
    };
    expect(body.outcomes).toHaveLength(2);
    expect(body.summary.published).toBe(2);
    expect(body.summary.quota_hit).toBe(0);
  });

  it("mixed outcomes: quota_hit + published surfaces in summary", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.publish_song_batch = () => ({
      data: [
        {
          job_id: A,
          public_id: "aaaaaaaaaa",
          visibility: "public",
          published_at: "2026-05-17T12:00:00Z",
          outcome: "published",
        },
        {
          job_id: B,
          public_id: null,
          visibility: "private",
          published_at: null,
          outcome: "quota_hit",
        },
        {
          job_id: C,
          public_id: null,
          visibility: null,
          published_at: null,
          outcome: "not_found",
        },
      ],
      error: null,
    });
    authed(s);
    const res = await POST(
      makeReq({ job_ids: [A, B, C], visibility: "public" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcomes: { outcome: string }[];
      summary: Record<string, number>;
    };
    expect(body.summary.published).toBe(1);
    expect(body.summary.quota_hit).toBe(1);
    expect(body.summary.not_found).toBe(1);
  });

  it("dedupes job_ids before calling the RPC", async () => {
    const s = makeFakeSupabase();
    let received: string[] | null = null;
    s.__state.rpc_handlers.publish_song_batch = (args: unknown) => {
      received = (args as { p_job_ids: string[] }).p_job_ids;
      return {
        data: received.map((id) => ({
          job_id: id,
          public_id: "x",
          visibility: "public",
          published_at: "2026-05-17T12:00:00Z",
          outcome: "published",
        })),
        error: null,
      };
    };
    authed(s);
    const res = await POST(
      makeReq({ job_ids: [A, A, A, B], visibility: "public" }),
    );
    expect(res.status).toBe(200);
    expect(received).not.toBeNull();
    expect(new Set(received as unknown as string[])).toEqual(new Set([A, B]));
    expect((received as unknown as string[]).length).toBe(2);
  });

  it("translates SQLSTATE 22023 -> 422", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.publish_song_batch = () => ({
      data: null,
      error: { message: "invalid visibility", code: "22023" } as never,
    });
    authed(s);
    const res = await POST(makeReq({ job_ids: [A], visibility: "public" }));
    expect(res.status).toBe(422);
  });

  it("translates unknown SQLSTATE -> 500", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.publish_song_batch = () => ({
      data: null,
      error: { message: "boom", code: "99999" } as never,
    });
    authed(s);
    const res = await POST(makeReq({ job_ids: [A], visibility: "public" }));
    expect(res.status).toBe(500);
  });
});
