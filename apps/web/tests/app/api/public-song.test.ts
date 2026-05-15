/**
 * Tests for the public share-surface read endpoints (M1, ADR 0013):
 *
 *   - GET /api/p/[publicId]            -> public song JSON (no auth)
 *   - GET /api/p/[publicId]/audio-url  -> public signed-URL mint
 *
 * Both routes:
 *   - reject syntactically-invalid public_ids with 404 (we use 404
 *     instead of 400 so the existence of valid-shape unpublished ids
 *     isn't leaked)
 *   - go through the Supabase client (server / service-role) and rely
 *     on the RLS/visibility column to scope reads
 *   - return 404 for unknown / private songs
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as GET_JSON } from "../../../app/api/p/[publicId]/route";
import { GET as GET_AUDIO } from "../../../app/api/p/[publicId]/audio-url/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/server", () => ({
  createServerClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

import {
  createServerClient,
  createServiceRoleClient,
} from "../../../lib/supabase/server";

const VALID_ID = "0abc12defg";
const INVALID_ID = "ABC!@#";

function withServer(supabase: FakeSupabase) {
  vi.mocked(createServerClient).mockReturnValue(supabase as never);
}
function withServiceRole(supabase: FakeSupabase) {
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase as never);
}

beforeEach(() => {
  vi.mocked(createServerClient).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/p/[publicId]", () => {
  it("returns 404 for syntactically invalid id", async () => {
    const s = makeFakeSupabase();
    withServer(s);
    const req = new NextRequest("http://localhost/api/p/x");
    const res = await GET_JSON(req, { params: { publicId: INVALID_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when no published song matches", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles.jobs = null;
    withServer(s);
    const req = new NextRequest("http://localhost/api/p/x");
    const res = await GET_JSON(req, { params: { publicId: VALID_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 200 with song document for a published song", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles.jobs = {
      id: "job-1",
      status: "completed",
      public_id: VALID_ID,
      published_at: "2026-05-15T00:00:00Z",
      published_visibility: "unlisted",
      song_documents: {
        document_json: {
          style_family: "carnatic",
          language: "kn",
          target_duration_seconds: 90,
          sections: [],
        },
        language: "kn",
        style_family: "carnatic",
      },
    };
    withServer(s);
    const req = new NextRequest("http://localhost/api/p/x");
    const res = await GET_JSON(req, { params: { publicId: VALID_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.public_id).toBe(VALID_ID);
    expect(body.visibility).toBe("unlisted");
    expect(body.style_family).toBe("carnatic");
    expect(body.language).toBe("kn");
    expect(body.song_document.sections).toEqual([]);
    expect(res.headers.get("cache-control")).toMatch(/max-age=60/);
  });
});

describe("GET /api/p/[publicId]/audio-url", () => {
  it("returns 404 for syntactically invalid id", async () => {
    const s = makeFakeSupabase();
    withServiceRole(s);
    const req = new NextRequest("http://localhost/api/p/x/audio-url");
    const res = await GET_AUDIO(req, { params: { publicId: INVALID_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when no published song matches", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles.jobs = null;
    withServiceRole(s);
    const req = new NextRequest("http://localhost/api/p/x/audio-url");
    const res = await GET_AUDIO(req, { params: { publicId: VALID_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the song has no completed track yet", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles.jobs = {
      id: "job-1",
      status: "processing",
      public_id: VALID_ID,
      published_visibility: "unlisted",
      tracks: [],
    };
    withServiceRole(s);
    const req = new NextRequest("http://localhost/api/p/x/audio-url");
    const res = await GET_AUDIO(req, { params: { publicId: VALID_ID } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("no_track");
  });

  it("mints a signed URL when the song is completed", async () => {
    const s = makeFakeSupabase();
    s.__state.signed_url = "https://signed.example.test/abc.mp3";
    s.__state.select_singles.jobs = {
      id: "job-1",
      status: "completed",
      public_id: VALID_ID,
      published_visibility: "public",
      tracks: [
        {
          id: "tr-1",
          url: "tracks/job-1/attempt-1.mp3",
          duration_seconds: 90,
          format: "mp3",
          bytes: 12345,
          created_at: "2026-05-15T00:00:00Z",
        },
      ],
    };
    withServiceRole(s);
    const req = new NextRequest("http://localhost/api/p/x/audio-url");
    const res = await GET_AUDIO(req, { params: { publicId: VALID_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://signed.example.test/abc.mp3");
    expect(body.format).toBe("mp3");
    expect(body.duration_seconds).toBe(90);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
