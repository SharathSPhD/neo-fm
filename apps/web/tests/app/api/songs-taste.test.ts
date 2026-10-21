/** POST /api/songs with a taste brief: stored in document metadata only with TASTE_BRIEF=1, free text screened first. */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("../../../lib/safety", () => ({ screenRequest: vi.fn() }));

import { POST } from "../../../app/api/songs/route";
import { screenRequest } from "../../../lib/safety";
import { requireUser } from "../../../lib/supabase/auth";

const taste = { genres: ["indie folk"], instruments: ["sitar"], background: "city kid, summers in the village" };

function req() {
  return new NextRequest("http://localhost/api/songs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "a song about rain", language: "en", style_family: "western", target_duration_seconds: 30, taste }),
  });
}

function setup(allowed = true) {
  const rpc = vi.fn().mockResolvedValue({ data: [{ job_id: "j", song_id: "s", status: "queued" }], error: null });
  (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u" }, supabase: { rpc } });
  (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue(allowed ? { allowed: true } : { allowed: false, category: "x", reason: "no" });
  return rpc;
}
const storedMetadata = (rpc: ReturnType<typeof vi.fn>) => (rpc.mock.calls[0]![1] as { p_song_document: { metadata?: Record<string, unknown> } }).p_song_document.metadata;

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("POST /api/songs taste brief", () => {
  it("stores the brief beside the prompt and screens the background when on", async () => {
    vi.stubEnv("TASTE_BRIEF", "1");
    const rpc = setup();
    expect((await POST(req())).status).toBe(202);
    expect(storedMetadata(rpc)).toMatchObject({ prompt: "a song about rain", taste: { v: 1, genres: ["indie folk"], instruments: ["sitar"], background: taste.background } });
    expect(screenRequest).toHaveBeenCalledWith(taste.background, "brief", { lang: "en" });
  });

  it("refuses a flagged background and creates nothing", async () => {
    vi.stubEnv("TASTE_BRIEF", "1");
    const rpc = setup(false);
    expect((await POST(req())).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores the brief when the flag is off", async () => {
    const rpc = setup();
    expect((await POST(req())).status).toBe(202);
    expect(storedMetadata(rpc)).not.toHaveProperty("taste");
  });
});
