/**
 * Tests for /api/songs/[id]/cover-art-template (v1.4 Sprint 1).
 */
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/cover-art-template/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

// The route uses a service-role client for the storage.upload call.
// We swap it for the same fake we wire as the user-context client so the
// upload spy is observable, and so the RPC call doesn't try to hit a real
// Supabase project.
const serviceFake = { value: null as FakeSupabase | null };
vi.mock("../../../lib/supabase/server", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/supabase/server")>(
      "../../../lib/supabase/server",
    );
  return {
    ...actual,
    createServiceRoleClient: () => {
      if (!serviceFake.value) {
        throw new Error("test forgot to set serviceFake.value");
      }
      return serviceFake.value;
    },
  };
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
  serviceFake.value = null;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/songs/[id]/cover-art-template", () => {
  it("returns 400 for invalid song id", async () => {
    const s = makeFakeSupabase();
    authed(s);
    serviceFake.value = makeFakeSupabase();
    const res = await POST(new Request("http://x"), {
      params: { id: "nope" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the song isn't found", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = null;
    authed(s);
    serviceFake.value = makeFakeSupabase();
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(404);
  });

  it("uploads SVG bytes, calls record_cover_art_template, returns 200", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = {
      id: SONG_ID,
      user_id: USER_ID,
      song_documents: {
        title: "Bhavageete morning",
        language: "kn",
        style_family: "kannada-light-classical",
      },
    };
    s.__state.rpc_handlers.record_cover_art_template = (args) => {
      const a = args as {
        p_song_id: string;
        p_attempt_id: string;
        p_prompt: string;
        p_storage_path: string;
      };
      expect(a.p_song_id).toBe(SONG_ID);
      expect(a.p_storage_path.startsWith(USER_ID)).toBe(true);
      expect(a.p_storage_path.endsWith(".svg")).toBe(true);
      expect(a.p_prompt).toContain("template:");
      expect(a.p_prompt).toContain("Bhavageete morning");
      return {
        data: [
          {
            attempt_id: a.p_attempt_id,
            cover_art_id: "33333333-3333-3333-3333-333333333333",
          },
        ],
        error: null,
      };
    };
    authed(s);
    const service = makeFakeSupabase();
    serviceFake.value = service;

    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backend).toBe("template");
    expect(body.url).toBe("https://signed.example.com/track.mp3");
    expect(typeof body.attempt_id).toBe("string");
    expect(body.cover_art_id).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
    expect(body.svg_size).toBeGreaterThan(200);

    // service-role bucket upload should have happened exactly once
    expect(service.__state.uploaded).toHaveLength(1);
    const upload = service.__state.uploaded[0]!;
    expect(upload.bucket).toBe("cover-art");
    expect(upload.contentType).toBe("image/svg+xml");
    expect(upload.upsert).toBe(true);
  });

  it("returns 500 when storage.upload fails", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = {
      id: SONG_ID,
      user_id: USER_ID,
      song_documents: {
        title: "any",
        language: "en",
        style_family: "western",
      },
    };
    authed(s);
    const service = makeFakeSupabase();
    // Force upload to error by monkey-patching storage.from.
    service.storage.from = vi.fn(() => ({
      createSignedUrl: () =>
        Promise.resolve({
          data: { signedUrl: "https://signed.example.com" },
          error: null,
        }),
      upload: () =>
        Promise.resolve({ data: null, error: { message: "bucket missing" } }),
    })) as never;
    serviceFake.value = service;
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("upload_failed");
  });

  it("returns 500 when the RPC fails", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = {
      id: SONG_ID,
      user_id: USER_ID,
      song_documents: {
        title: "x",
        language: "en",
        style_family: "western",
      },
    };
    s.__state.rpc_handlers.record_cover_art_template = () => ({
      data: null,
      error: { message: "not_owner" },
    });
    authed(s);
    serviceFake.value = makeFakeSupabase();
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("record_failed");
  });
});
