import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/station/week-load", () => ({ loadWeek: vi.fn(async () => ({ empty: true })) }));

import { requireUser } from "@/lib/supabase/auth";
import { GET } from "../app/api/station/week/route";

beforeEach(() => vi.mocked(requireUser).mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/station/week", () => {
  it("is 404 when STATION_WEEK is off, before any auth or data read", async () => {
    const res = await GET(new Request("http://x/api/station/week"));
    expect(res.status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("requires a signed-in listener", async () => {
    vi.stubEnv("STATION_WEEK", "1");
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(new Request("http://x/api/station/week"))).status).toBe(401);
  });

  it("returns the caller's week, never cached", async () => {
    vi.stubEnv("STATION_WEEK", "1");
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await GET(new Request("http://x/api/station/week"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ week: { empty: true } });
  });
});
