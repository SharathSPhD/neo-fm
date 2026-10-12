/**
 * POST /api/songs with version_of: goes through the normal create path
 * (moderation + create_song_job quota RPC), links the new row via a
 * service-role write pinned to the caller, never touches the parent row.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("../../../lib/safety", () => ({ screenRequest: vi.fn() }));

import { POST } from "../../../app/api/songs/route";
import { screenRequest } from "../../../lib/safety";
import { requireUser } from "../../../lib/supabase/auth";
import { createServiceRoleClient } from "../../../lib/supabase/server";

const USER = "00000000-0000-0000-0000-000000000001";
const PARENT = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const JOB = "22222222-2222-4222-8222-222222222222";

function body(extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/songs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "A Tamil version of x",
      language: "ta",
      style_family: "western",
      target_duration_seconds: 60,
      version_of: PARENT,
      ...extra,
    }),
  });
}

type Q = { data: unknown; error?: unknown };

function setup(opts: {
  parent?: Q;
  group?: Q;
  rpc?: Q;
  link?: Q;
  allowed?: boolean;
}) {
  const rpc = vi.fn().mockResolvedValue(
    opts.rpc ?? { data: [{ job_id: JOB, song_id: "s", status: "queued" }], error: null },
  );
  const reads = [opts.parent ?? { data: { id: PARENT, song_documents: { language: "hi" } } }, opts.group ?? { data: { version_group: null } }];
  const userClient = {
    rpc,
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(reads.shift() ?? { data: null });
      return b;
    },
  };
  (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: USER }, supabase: userClient });
  (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
    opts.allowed === false ? { allowed: false, category: "x", reason: "no" } : { allowed: true },
  );
  const update = vi.fn();
  const eqs: unknown[][] = [];
  const svc = {
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      b.update = (v: unknown) => {
        update(t, v);
        return b;
      };
      b.eq = (...a: unknown[]) => {
        eqs.push(a);
        return b;
      };
      b.select = () => Promise.resolve(opts.link ?? { data: [{ id: JOB }], error: null });
      return b;
    },
  };
  (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);
  return { rpc, update, eqs };
}

afterEach(() => vi.resetAllMocks());

describe("POST /api/songs version_of", () => {
  it("creates through create_song_job and links the new row to the parent's group", async () => {
    const { rpc, update, eqs } = setup({ group: { data: { version_group: GROUP } } });
    const res = await POST(body());
    expect(res.status).toBe(202);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("jobs", { version_group: GROUP });
    // pinned to the new row and the caller; the parent is never updated
    expect(eqs).toContainEqual(["id", JOB]);
    expect(eqs).toContainEqual(["user_id", USER]);
    expect(eqs.flat()).not.toContain(PARENT);
  });

  it("uses the parent itself as the group when it has none", async () => {
    const { update } = setup({});
    await POST(body());
    expect(update).toHaveBeenCalledWith("jobs", { version_group: PARENT });
  });

  it("moderation still gates the brief and no job is created", async () => {
    const { rpc } = setup({ allowed: false });
    const res = await POST(body());
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s when the parent isn't visible to the caller (RLS), creating nothing", async () => {
    const { rpc } = setup({ parent: { data: null } });
    expect((await POST(body())).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a same-language version", async () => {
    const { rpc } = setup({});
    expect((await POST(body({ language: "hi" }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("quota errors from the RPC still surface as 429 and nothing is linked", async () => {
    const { update } = setup({ rpc: { data: null, error: { message: "quota_exceeded" } } });
    expect((await POST(body())).status).toBe(429);
    expect(update).not.toHaveBeenCalled();
  });

  it("warns, but still accepts, when the link write fails", async () => {
    setup({ link: { data: null, error: { message: "column does not exist" } } });
    const res = await POST(body());
    expect(res.status).toBe(202);
    expect((await res.json()).warning).toBe("version_link_failed");
  });
});
