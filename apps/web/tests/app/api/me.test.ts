/**
 * Tests for GET /api/me.
 */
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../../app/api/me/route";
import { makeFakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER = { id: "00000000-0000-0000-0000-000000000001" };

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/me", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the user profile", async () => {
    const supabase = makeFakeSupabase();
    supabase.__state.select_singles.users = {
      id: USER.id,
      email: "tester@neo-fm.example",
      name: "tester",
      locale: "en",
      tier: "free",
    };
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: USER as never,
      supabase: supabase as never,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: USER.id,
      email: "tester@neo-fm.example",
      tier: "free",
    });
  });

  it("404 when profile is missing", async () => {
    const supabase = makeFakeSupabase();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: USER as never,
      supabase: supabase as never,
    });
    const res = await GET();
    expect(res.status).toBe(404);
  });
});
