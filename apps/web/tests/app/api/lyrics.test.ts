/**
 * Tests for GET /api/lyrics and GET /api/lyrics/[id].
 *
 * The endpoints serve the bundled public-domain corpus (12 lyrics across
 * en/hi/kn). We verify:
 *   - listing filters by language
 *   - listing strips the long body to a snippet
 *   - listing rejects unknown languages with 400
 *   - listing returns 401 for unauthenticated callers
 *   - detail returns the full body for a known id
 *   - detail returns 404 for an unknown id
 *   - detail URL-decodes the id so `hi%2Fkabir-pothi` -> `hi/kabir-pothi`
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as GET_LIST } from "../../../app/api/lyrics/route";
import { GET as GET_ONE } from "../../../app/api/lyrics/[id]/route";
import { makeFakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

function authedRequire() {
  const s = makeFakeSupabase();
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: s as never,
  });
}

describe("GET /api/lyrics", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const req = new NextRequest("http://localhost/api/lyrics?language=hi");
    const res = await GET_LIST(req);
    expect(res.status).toBe(401);
  });

  it("rejects unknown languages with 400", async () => {
    // v1.3 Sprint 2 promoted "ta" into LanguageSchema, so the
    // original test (which used "ta" as the bogus value) is no
    // longer valid. Use a genuinely unsupported code instead.
    authedRequire();
    const req = new NextRequest("http://localhost/api/lyrics?language=xx");
    const res = await GET_LIST(req);
    expect(res.status).toBe(400);
  });

  it("returns Hindi lyrics filtered by language", async () => {
    authedRequire();
    const req = new NextRequest("http://localhost/api/lyrics?language=hi");
    const res = await GET_LIST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; author: string; language: string; snippet: string }[];
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.language === "hi")).toBe(true);
    // Kabir is in the bundled hi corpus.
    expect(body.items.some((i) => i.author.toLowerCase().includes("kabir"))).toBe(true);
    // Snippet should be capped (the corpus has bodies > 280 chars in some
    // entries; for short ones it should equal the full body).
    for (const item of body.items) {
      expect(item.snippet.length).toBeLessThanOrEqual(281);
    }
  });

  it("returns Kannada lyrics filtered by language", async () => {
    authedRequire();
    const req = new NextRequest("http://localhost/api/lyrics?language=kn");
    const res = await GET_LIST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; language: string }[];
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.language === "kn")).toBe(true);
  });
});

describe("GET /api/lyrics/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const req = new NextRequest("http://localhost/api/lyrics/hi/kabir-pothi");
    const res = await GET_ONE(req, { params: { id: "hi/kabir-pothi" } });
    expect(res.status).toBe(401);
  });

  it("returns the full body for a known id (path-encoded)", async () => {
    authedRequire();
    const req = new NextRequest("http://localhost/api/lyrics/hi%2Fkabir-pothi");
    // Next.js decodes the path segment before passing it in; we simulate the
    // already-decoded path here, but the route also tolerates a re-encoded
    // value (it calls decodeURIComponent internally).
    const res = await GET_ONE(req, { params: { id: "hi%2Fkabir-pothi" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; body: string; language: string };
    expect(body.id).toBe("hi/kabir-pothi");
    expect(body.language).toBe("hi");
    expect(body.body.length).toBeGreaterThan(20);
  });

  it("returns 404 for an unknown id", async () => {
    authedRequire();
    const req = new NextRequest("http://localhost/api/lyrics/hi/nope");
    const res = await GET_ONE(req, { params: { id: "hi/nope" } });
    expect(res.status).toBe(404);
  });
});
