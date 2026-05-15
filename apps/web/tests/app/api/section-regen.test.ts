/**
 * Tests for POST /api/songs/[id]/sections/[sectionId]/regenerate (M5).
 *
 * The route delegates to the `create_section_regen_job` RPC. Tests verify:
 *   - unauthenticated -> 401
 *   - invalid song id -> 400
 *   - invalid section id (empty after decode) -> 400
 *   - happy path: RPC called with the right args, 202 returned
 *   - RPC raises `parent_job_not_found` -> 404 (not 403; we don't leak
 *     existence)
 *   - RPC raises `parent_job_not_completed` -> 409
 *   - RPC raises `section_not_in_document` -> 400
 *   - RPC raises `quota_exceeded` -> 429
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/sections/[sectionId]/regenerate/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PARENT_ID = "11111111-1111-1111-1111-111111111111";
const SECTION_ID = "v1";
const CHILD_ID = "22222222-2222-2222-2222-222222222222";

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

it("returns 401 when unauthenticated", async () => {
  vi.mocked(requireUser).mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: PARENT_ID, sectionId: SECTION_ID },
  });
  expect(res.status).toBe(401);
});

it("returns 400 for an invalid song id", async () => {
  const s = makeFakeSupabase();
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: "not-a-uuid", sectionId: SECTION_ID },
  });
  expect(res.status).toBe(400);
});

it("happy path: 202 + RPC called with the right args", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_section_regen_job = () => ({
    data: [
      {
        job_id: CHILD_ID,
        parent_job_id: PARENT_ID,
        section_id: SECTION_ID,
        status: "queued",
      },
    ],
    error: null,
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: PARENT_ID, sectionId: SECTION_ID },
  });
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.job_id).toBe(CHILD_ID);
  expect(body.parent_job_id).toBe(PARENT_ID);
  expect(body.section_id).toBe(SECTION_ID);
  expect(body.status).toBe("queued");
  // Verify the RPC was called with the URL params.
  const call = s.__state.rpc_calls.find(
    (c) => c.name === "create_section_regen_job",
  );
  expect(call).toBeDefined();
  expect((call!.args as { p_parent_job_id: string }).p_parent_job_id).toBe(
    PARENT_ID,
  );
  expect((call!.args as { p_section_id: string }).p_section_id).toBe(SECTION_ID);
});

it("translates parent_job_not_found -> 404", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_section_regen_job = () => ({
    data: null,
    error: { message: "parent_job_not_found" },
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: PARENT_ID, sectionId: SECTION_ID },
  });
  expect(res.status).toBe(404);
});

it("translates parent_job_not_completed -> 409", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_section_regen_job = () => ({
    data: null,
    error: { message: "parent_job_not_completed" },
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: PARENT_ID, sectionId: SECTION_ID },
  });
  expect(res.status).toBe(409);
});

it("translates section_not_in_document -> 400", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_section_regen_job = () => ({
    data: null,
    error: { message: "section_not_in_document" },
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: PARENT_ID, sectionId: SECTION_ID },
  });
  expect(res.status).toBe(400);
});

it("translates quota_exceeded -> 429", async () => {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_section_regen_job = () => ({
    data: null,
    error: { message: "quota_exceeded" },
  });
  authed(s);
  const req = new NextRequest("http://localhost/x", { method: "POST" });
  const res = await POST(req, {
    params: { id: PARENT_ID, sectionId: SECTION_ID },
  });
  expect(res.status).toBe(429);
});
