import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UI_LANGS } from "@/lib/i18n/ui-strings";
import { WEEK_STRINGS } from "@/lib/station/week-strings";

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/station/week-load", () => ({ loadWeek: vi.fn(async () => ({ empty: true })) }));
vi.mock("@/lib/station/week-image", () => ({ renderWeekStory: vi.fn(async () => new Response("png", { headers: { "content-type": "image/png" } })) }));

import { requireUser } from "@/lib/supabase/auth";
import { GET } from "../app/api/station/week/image/route";

const req = (qs = "") => new NextRequest(`http://x/api/station/week/image${qs}`);

beforeEach(() => vi.mocked(requireUser).mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("week copy", () => {
  it("covers every UI language with no empty string", () => {
    for (const l of UI_LANGS) for (const v of Object.values(WEEK_STRINGS[l])) expect(v.length).toBeGreaterThan(0);
  });
});

describe("GET /api/station/week/image", () => {
  it("is 404 when STATION_WEEK is off, before any auth", async () => {
    expect((await GET(req())).status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("requires a signed-in listener", async () => {
    vi.stubEnv("STATION_WEEK", "1");
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
  });

  it("returns a private, noindex image and offers a download", async () => {
    vi.stubEnv("STATION_WEEK", "1");
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await GET(req("?lang=hi&download=1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("content-disposition")).toContain("neo-fm-week.png");
  });
});
