/**
 * PUT /api/songs/[id]/dedication: moderation must gate every write, and the
 * write must go through the service client (the RPC is service_role only), so
 * a signed-in user can't publish unmoderated text by calling the RPC directly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("../../../lib/safety", () => ({ screenRequest: vi.fn() }));

import { PUT } from "../../../app/api/songs/[id]/dedication/route";
import { screenRequest } from "../../../lib/safety";
import { requireUser } from "../../../lib/supabase/auth";
import { createServiceRoleClient } from "../../../lib/supabase/server";

const JOB = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function req(body: unknown) {
  return new Request("https://x.test/api/songs/x/dedication", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PUT>[0];
}

function setup(opts: { allowed: boolean; rpcError?: { code: string } | null }) {
  const userRpc = vi.fn();
  (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: USER },
    supabase: { rpc: userRpc },
  });
  (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
    opts.allowed ? { allowed: true } : { allowed: false, category: "hate_harassment", reason: "no" },
  );
  const svcRpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: svcRpc });
  return { userRpc, svcRpc };
}

afterEach(() => vi.resetAllMocks());

describe("PUT /api/songs/[id]/dedication", () => {
  it("requires auth", async () => {
    (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await PUT(req({ to: "Amma" }), { params: Promise.resolve({ id: JOB }) });
    expect(res.status).toBe(401);
  });

  it("blocked text never reaches the database", async () => {
    const { svcRpc, userRpc } = setup({ allowed: false });
    const res = await PUT(req({ to: "Amma", message: "bad" }), { params: Promise.resolve({ id: JOB }) });
    expect(res.status).toBe(422);
    expect(svcRpc).not.toHaveBeenCalled();
    expect(userRpc).not.toHaveBeenCalled();
  });

  it("moderated text is written via the service client with the caller as owner", async () => {
    const { svcRpc, userRpc } = setup({ allowed: true });
    const res = await PUT(req({ to: " Amma ", message: "Happy birthday" }), { params: Promise.resolve({ id: JOB }) });
    expect(res.status).toBe(200);
    expect(userRpc).not.toHaveBeenCalled();
    expect(svcRpc).toHaveBeenCalledWith("set_dedication", {
      p_job_id: JOB,
      p_owner_id: USER,
      p_to: "Amma",
      p_message: "Happy birthday",
    });
  });

  it("clearing skips moderation and maps a non-owner to 403", async () => {
    const { svcRpc } = setup({ allowed: true, rpcError: { code: "42501" } });
    const res = await PUT(req({ to: null, message: null }), { params: Promise.resolve({ id: JOB }) });
    expect(screenRequest).not.toHaveBeenCalled();
    expect(svcRpc).toHaveBeenCalled();
    expect(res.status).toBe(403);
  });
});

describe("migration 0074 privileges", () => {
  const sql = readFileSync(
    join(process.cwd(), "../../infra/supabase/migrations/0074_song_dedication.sql"),
    "utf8",
  );
  it("is not executable by anon or authenticated", () => {
    expect(sql).toMatch(
      /revoke all on function public\.set_dedication\(uuid, uuid, text, text\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(/grant execute on function public\.set_dedication\(uuid, uuid, text, text\) to service_role/);
    expect(sql).not.toMatch(/grant execute[^;]*to[^;]*authenticated/i);
  });
});
