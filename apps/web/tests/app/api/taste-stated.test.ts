/** /api/me/taste/stated: saved taste brief, behind TASTE_BRIEF, the 'personalize' consent and migration 0113. */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("../../../lib/safety", () => ({ screenRequest: vi.fn() }));
vi.mock("../../../lib/personalization/load", () => ({ hasPersonalizationConsent: vi.fn() }));

import { DELETE, GET, PUT } from "../../../app/api/me/taste/stated/route";
import { hasPersonalizationConsent } from "../../../lib/personalization/load";
import { screenRequest } from "../../../lib/safety";
import { requireUser } from "../../../lib/supabase/auth";
import { createServiceRoleClient } from "../../../lib/supabase/server";

const taste = { genres: ["carnatic"], instruments: ["veena"], background: "grew up in Mysuru" };
const put = () => new NextRequest("http://localhost/api/me/taste/stated", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ taste }) });

function setup(opts: { consent?: boolean; allowed?: boolean; writeError?: boolean; readError?: boolean; stored?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.writeError ? { code: "42703" } : null });
  (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: () => ({ upsert }) });
  const read = { data: { stated: opts.stored ?? null }, error: opts.readError ? { code: "42703" } : null };
  (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "u" },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(read) }) }) }) },
  });
  (hasPersonalizationConsent as ReturnType<typeof vi.fn>).mockResolvedValue(opts.consent !== false);
  (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue(opts.allowed === false ? { allowed: false, category: "x", reason: "no" } : { allowed: true });
  return upsert;
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("/api/me/taste/stated", () => {
  it("is a 404 when TASTE_BRIEF is off", async () => {
    setup();
    expect((await GET()).status).toBe(404);
    expect((await PUT(put())).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
  });

  it("saves the normalised brief for the caller with consent", async () => {
    vi.stubEnv("TASTE_BRIEF", "1");
    const upsert = setup();
    const res = await PUT(put());
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u", stated: expect.objectContaining({ v: 1, genres: ["carnatic"] }) }), { onConflict: "user_id" });
  });

  it("needs consent, a clean background, and the column", async () => {
    vi.stubEnv("TASTE_BRIEF", "1");
    let upsert = setup({ consent: false });
    expect((await PUT(put())).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
    upsert = setup({ allowed: false });
    expect((await PUT(put())).status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
    setup({ writeError: true });
    expect((await PUT(put())).status).toBe(503);
  });

  it("reads the saved brief, and degrades before migration 0113", async () => {
    vi.stubEnv("TASTE_BRIEF", "1");
    setup({ stored: { v: 1, moods: ["calm"] } });
    expect(await (await GET()).json()).toEqual({ taste: { v: 1, moods: ["calm"] } });
    setup({ readError: true });
    expect(await (await GET()).json()).toEqual({ taste: null, available: false });
  });
});
