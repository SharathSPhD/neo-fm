/**
 * DPDP: DELETE /api/account erasure and GET /api/account/export completeness.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = { id: "u1", email: "a@b.c" };
const db = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error?: { message: string } | null }>,
  deleted: [] as string[],
  removed: [] as string[],
  listing: {} as Record<string, { id: string | null; name: string }[]>,
  removeError: null as { message: string } | null,
  selects: [] as { table: string; cols: string }[],
  deleteUser: vi.fn(),
  cancel: vi.fn(),
  delCustomer: vi.fn(),
}));

function chain(table: string) {
  const result = () => db.tables[table] ?? { data: [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["eq", "in", "order"]) q[m] = () => q;
  q.select = (cols: string) => { db.selects.push({ table, cols }); return q; };
  q.maybeSingle = async () => result();
  q.delete = () => ({ eq: async () => { db.deleted.push(table); return { error: db.tables[`${table}:delete`]?.error ?? null }; } });
  q.then = (res: (v: unknown) => unknown) => res(result());
  return q;
}
const admin = () => ({
  from: chain,
  auth: { admin: { deleteUser: db.deleteUser } },
  storage: {
    from: (bucket: string) => ({
      list: async (p: string) => ({ data: db.listing[`${bucket}/${p}`] ?? [], error: null }),
      remove: async (paths: string[]) => { db.removed.push(...paths.map((p) => `${bucket}/${p}`)); return { error: db.removeError }; },
    }),
  },
});

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => admin() }));
vi.mock("@/lib/agent/adapters", () => ({ serviceClient: () => admin() }));
vi.mock("@/lib/billing/config", () => ({ getBillingConfigOrNull: () => ({}) }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ subscriptions: { cancel: db.cancel }, customers: { del: db.delCustomer } }) }));

import { requireUser } from "@/lib/supabase/auth";
import { DELETE } from "../../../app/api/account/route";
import { GET } from "../../../app/api/account/export/route";

beforeEach(() => {
  db.tables = {}; db.selects = []; db.deleted = []; db.removed = []; db.listing = {}; db.removeError = null;
  db.deleteUser.mockReset().mockResolvedValue({ error: null });
  db.cancel.mockReset().mockResolvedValue({}); db.delCustomer.mockReset().mockResolvedValue({});
  vi.mocked(requireUser).mockReset().mockResolvedValue({ user: USER, supabase: admin() } as never);
});

describe("DELETE /api/account", () => {
  it("401 when unauthenticated and deletes nothing", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await DELETE()).status).toBe(401);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });
  it("erases billing, stored files (including nested folders), feedback, then the auth user", async () => {
    db.tables.user_billing = { data: { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" } };
    db.tables.jobs = { data: [{ id: "j1" }] };
    db.listing["tracks/j1"] = [{ id: "a", name: "audio.wav" }, { id: null, name: "stems" }];
    db.listing["tracks/j1/stems"] = [{ id: "b", name: "vocals.wav" }];
    db.listing["cover-art/u1"] = [{ id: null, name: "j1" }];
    db.listing["cover-art/u1/j1"] = [{ id: "c", name: "att.png" }];
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(db.cancel).toHaveBeenCalledWith("sub_1");
    expect(db.delCustomer).toHaveBeenCalledWith("cus_1");
    expect(db.removed.sort()).toEqual(["cover-art/u1/j1/att.png", "tracks/j1/audio.wav", "tracks/j1/stems/vocals.wav"]);
    expect(db.deleted).toContain("feedback");
    expect(db.deleteUser).toHaveBeenCalledWith("u1");
    expect(await res.json()).toMatchObject({ deleted: true, steps: { audio_files_removed: "3", stripe_customer: "deleted" } });
  });
  it("tolerates a subscription or customer already gone on a retry", async () => {
    db.tables.user_billing = { data: { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" } };
    db.cancel.mockRejectedValue(Object.assign(new Error("gone"), { code: "resource_missing" }));
    db.delCustomer.mockRejectedValue(Object.assign(new Error("gone"), { code: "resource_missing" }));
    expect((await DELETE()).status).toBe(200);
    expect(db.deleteUser).toHaveBeenCalled();
  });
  it("keeps the account when Stripe cancellation fails", async () => {
    db.tables.user_billing = { data: { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" } };
    db.cancel.mockRejectedValue(new Error("stripe down"));
    expect((await DELETE()).status).toBe(502);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });
  it("keeps the account when stored files cannot be removed", async () => {
    db.tables.jobs = { data: [{ id: "j1" }] };
    db.listing["tracks/j1"] = [{ id: "a", name: "audio.wav" }];
    db.removeError = { message: "storage down" };
    expect((await DELETE()).status).toBe(502);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });
  it("keeps the account when feedback deletion fails", async () => {
    db.tables["feedback:delete"] = { data: null, error: { message: "nope" } };
    expect((await DELETE()).status).toBe(500);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });
  it("reports auth deletion failure", async () => {
    db.deleteUser.mockResolvedValue({ error: { message: "boom" } });
    expect((await DELETE()).status).toBe(500);
  });
});

describe("GET /api/account/export", () => {
  it("includes every personal-data category", async () => {
    db.tables.users = { data: { id: "u1", email: "a@b.c", tier: "free" } };
    db.tables.jobs = { data: [{ id: "j1" }] };
    db.tables.user_presets = { data: [{ name: "p" }] };
    db.tables.song_likes = { data: [{ job_id: "j9" }] };
    db.tables.follows = { data: [{ followee_id: "u2" }] };
    db.tables.preference_pairs = { data: [{ id: 1 }] };
    db.tables.feedback = { data: [{ body: "hi" }] };
    db.tables.consents = { data: [{ kind: "training" }] };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      export_version: 3,
      user: { id: "u1" },
      songs: [{ id: "j1" }],
      presets: [{ name: "p" }],
      likes: [{ job_id: "j9" }],
      follows: [{ followee_id: "u2" }],
      preference_pairs: [{ id: 1 }],
      feedback: [{ body: "hi" }],
      consents: [{ kind: "training" }],
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("only selects columns that exist in production (agent_runs has updated_at, not created_at)", async () => {
    const PROD_AGENT_RUNS = ["job_id", "session_id", "agent_key", "status", "lyria_calls", "audio_path", "lyrics", "agent_song_document", "updated_at", "diction_qa", "polished_lyrics", "render_error"];
    await GET();
    const cols = db.selects.find((x) => x.table === "agent_runs")?.cols.split(",").map((c) => c.trim()) ?? [];
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.filter((c) => !PROD_AGENT_RUNS.includes(c))).toEqual([]);
  });
  it("fails instead of returning a silently incomplete export", async () => {
    db.tables.song_likes = { data: null, error: { message: "db down" } };
    expect((await GET()).status).toBe(500);
  });
});
