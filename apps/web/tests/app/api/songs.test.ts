/**
 * Tests for POST /api/songs (post Phase 4 hardening).
 *
 * After the adversarial review, job creation is a single SECURITY DEFINER
 * RPC (`public.create_song_job`) that atomically does quota + insert +
 * enqueue. The route's responsibilities are narrowed to: auth gate, Zod
 * validation, feature flag, RPC call, error translation.
 *
 * Goals:
 *   1. unauthenticated -> 401
 *   2. invalid body   -> 400
 *   3. prompt branch (flag off) -> 501
 *   4. happy path: RPC called with the right args, 202 returned
 *   5. quota_exceeded raised by RPC -> 429
 *   6. unknown RPC failure -> 500
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const SONG_ID = "11111111-1111-1111-1111-111111111111";

function makeUserClient(): FakeSupabase {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_song_job = () => ({
    data: [{ job_id: JOB_ID, song_id: SONG_ID, status: "queued" }],
    error: null,
  });
  return s;
}

function validBody() {
  return {
    song_document: {
      language: "en",
      style_family: "western",
      target_duration_seconds: 30,
      sections: [
        { id: "verse-1", type: "verse", target_seconds: 15 },
        { id: "chorus-1", type: "chorus", target_seconds: 15 },
      ],
    },
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/songs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/songs", () => {
  beforeEach(() => {
    process.env.NEO_FM_PROMPT_BRANCH_ENABLED = "false";
  });

  it("401 when unauthenticated", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireUser).mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it("400 on invalid body", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });
    const res = await POST(req({ song_document: { language: "xx" } }));
    expect(res.status).toBe(400);
  });

  it("501 for prompt branch when flag is off", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });
    const res = await POST(
      req({
        prompt: "a happy song",
        language: "en",
        style_family: "western",
        target_duration_seconds: 30,
      }),
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe("prompt_branch_not_yet_enabled");
  });

  it("happy path: calls create_song_job with the validated document and returns 202", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ job_id: JOB_ID, song_id: SONG_ID, status: "queued" });

    expect(user_client.__state.rpc_calls).toHaveLength(1);
    const call = user_client.__state.rpc_calls[0]!;
    expect(call.name).toBe("create_song_job");
    expect(call.args).toMatchObject({
      p_language: "en",
      p_style_family: "western",
      p_target_duration_seconds: 30,
      p_priority: 0,
    });
    // The route must NOT do any direct table inserts; the RPC owns the writes.
    expect(user_client.__state.inserted).toEqual([]);
  });

  it("429 with reason=rows_per_month when the RPC raises quota_exceeded", async () => {
    const user_client = makeUserClient();
    user_client.__state.rpc_handlers.create_song_job = () => ({
      data: null,
      error: { message: 'P0001: quota_exceeded\nWhere: PL/pgSQL function create_song_job' },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("quota_exceeded");
    expect(body.reason).toBe("rows_per_month");
    // ADR 0009: monthly window. Worst-case reset is start of next UTC month
    // (~31 days ≈ 2_678_400 s). Just confirm it's positive and < 32 days.
    expect(body.remaining_seconds_until_reset).toBeGreaterThan(0);
    expect(body.remaining_seconds_until_reset).toBeLessThanOrEqual(32 * 24 * 3600);
  });

  it("429 with reason=storage_bytes when the RPC raises storage_quota_exceeded", async () => {
    const user_client = makeUserClient();
    user_client.__state.rpc_handlers.create_song_job = () => ({
      data: null,
      error: {
        message:
          "P0001: storage_quota_exceeded\nWhere: PL/pgSQL function create_song_job",
      },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("quota_exceeded");
    expect(body.reason).toBe("storage_bytes");
    // ADR 0005: storage cap reset is not time-based; the client gets -1 so it
    // can render "delete an old song to free up space" instead of "try again".
    expect(body.remaining_seconds_until_reset).toBe(-1);
  });

  it("500 on unknown RPC failure", async () => {
    const user_client = makeUserClient();
    user_client.__state.rpc_handlers.create_song_job = () => ({
      data: null,
      error: { message: "deadlock detected" },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("create_song_job_failed");
  });

  // ---------- Co-composer integration (Sprint 1, Phase 6) ----------------
  //
  // The adversarial review flagged that /api/songs forwarded the user's
  // raw Song Document straight to the RPC -- the music engine never saw
  // the co-composer's tags / raga / tala / instrumentation for any style.
  // These tests guard against regressing back to that state.

  it("happy path western: persists composer-elaborated document, not raw", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(202);

    const persisted = user_client.__state.rpc_calls[0]!.args as {
      p_song_document: {
        style_family: string;
        sections: Array<{ tags?: string[] }>;
      };
    };
    const tagsFromFirstSection = persisted.p_song_document.sections[0]?.tags ?? [];
    expect(tagsFromFirstSection).toContain("style:western");
    expect(tagsFromFirstSection).toContain("section:verse");
    // Western composer adds a key + progression even when the producer
    // didn't supply one. This is the strongest marker that the composer
    // ran instead of pass-through.
    expect(
      tagsFromFirstSection.some((t) => t.startsWith("progression:")),
    ).toBe(true);
  });

  it("happy path carnatic: composer adds raga + tala + aroha tags", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(
      req({
        song_document: {
          language: "hi",
          style_family: "carnatic",
          target_duration_seconds: 60,
          sections: [
            { id: "p1", type: "pallavi", target_seconds: 30 },
            { id: "a1", type: "anupallavi", target_seconds: 30 },
          ],
        },
      }),
    );
    expect(res.status).toBe(202);

    const persisted = user_client.__state.rpc_calls[0]!.args as {
      p_song_document: {
        raga?: { name: string; system: string };
        tala?: string;
        sections: Array<{ tags?: string[]; type: string }>;
      };
    };
    // composer should have promoted raga onto the document
    expect(persisted.p_song_document.raga?.system).toBe("carnatic");
    expect(persisted.p_song_document.tala).toBeDefined();
    // and tagged every section with style + raga + tala + function
    const tags = persisted.p_song_document.sections[0]?.tags ?? [];
    expect(tags).toContain("style:carnatic");
    expect(tags.some((t) => t.startsWith("raga:"))).toBe(true);
    expect(tags.some((t) => t.startsWith("tala:"))).toBe(true);
    expect(tags.some((t) => t.startsWith("function:"))).toBe(true);
    expect(tags.some((t) => t.startsWith("aroha:"))).toBe(true);
  });

  it("happy path kannada-folk: composer adds genre tag and folk instrumentation", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(
      req({
        song_document: {
          language: "kn",
          style_family: "kannada-folk",
          target_duration_seconds: 60,
          sections: [
            { id: "r1", type: "folk_refrain", target_seconds: 30 },
            { id: "s1", type: "folk_stanza", target_seconds: 30 },
          ],
        },
      }),
    );
    expect(res.status).toBe(202);

    const persisted = user_client.__state.rpc_calls[0]!.args as {
      p_song_document: {
        orchestration?: { instruments?: string[] };
        sections: Array<{ tags?: string[] }>;
      };
    };
    expect(
      persisted.p_song_document.orchestration?.instruments ?? [],
    ).toContain("dhol");
    const tags = persisted.p_song_document.sections[0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith("genre:"))).toBe(true);
    expect(tags).toContain("style:kannada-folk");
  });
});
