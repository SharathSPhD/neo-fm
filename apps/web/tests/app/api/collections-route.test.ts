/**
 * Collections API: moderation gates every public text write, writes only
 * touch the caller's own rows, and private songs of other users can't be added.
 */
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("../../../lib/safety", () => ({ screenRequest: vi.fn() }));
vi.mock("../../../lib/collections/load", async (orig) => ({
  ...(await orig<typeof import("../../../lib/collections/load")>()),
  collectionsDb: vi.fn(),
}));

import { PATCH } from "../../../app/api/collections/[id]/route";
import { POST as ADD } from "../../../app/api/collections/[id]/items/route";
import { POST as CREATE } from "../../../app/api/collections/route";
import { collectionsDb } from "../../../lib/collections/load";
import { screenRequest } from "../../../lib/safety";
import { requireUser } from "../../../lib/supabase/auth";

const USER = "22222222-2222-4222-8222-222222222222";
const COL = "33333333-3333-4333-8333-333333333333";
const JOB = "11111111-1111-4111-8111-111111111111";

type Result = { data?: unknown; error?: { code?: string } | null; count?: number | null };

/** Chainable fake: every method returns the builder; awaiting/maybeSingle/single yield the queued result for the table. */
function fakeDb(tables: Record<string, Result[]>) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      const q = (): Result => tables[table]?.shift() ?? { data: null, error: null };
      const b: Record<string, unknown> = {};
      for (const op of ["select", "insert", "update", "delete", "eq", "in", "order", "limit", "returns"]) {
        b[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return b;
        };
      }
      b.maybeSingle = () => Promise.resolve(q());
      b.single = () => Promise.resolve(q());
      b.then = (res: (r: Result) => unknown) => res(q());
      return b;
    },
  };
  (collectionsDb as ReturnType<typeof vi.fn>).mockReturnValue(db);
  return calls;
}

function json(body: unknown) {
  return new Request("https://x.test/api", { method: "POST", body: JSON.stringify(body) }) as never;
}

function authed() {
  (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: USER }, supabase: {} });
}

afterEach(() => vi.resetAllMocks());

describe("POST /api/collections", () => {
  it("requires auth", async () => {
    (requireUser as ReturnType<typeof vi.fn>).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    expect((await CREATE(json({ title: "x" }))).status).toBe(401);
  });

  it("blocked text is never written", async () => {
    authed();
    (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, reason: "no" });
    const calls = fakeDb({});
    const res = await CREATE(json({ title: "bad", visibility: "public" }));
    expect(res.status).toBe(422);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("creates a collection owned by the caller with a minted slug", async () => {
    authed();
    (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
    const calls = fakeDb({
      collections: [{ count: 0 }, { data: { id: COL, title: "Bhajans" }, error: null }],
    });
    const res = await CREATE(json({ title: "Bhajans" }));
    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.op === "insert")!;
    const row = insert.args[0] as Record<string, unknown>;
    expect(row.user_id).toBe(USER);
    expect(row.visibility).toBe("private");
    expect(row.public_id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);
  });

  it("enforces the per-user limit", async () => {
    authed();
    (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
    fakeDb({ collections: [{ count: 50 }] });
    expect((await CREATE(json({ title: "one more" }))).status).toBe(409);
  });
});

describe("PATCH /api/collections/[id]", () => {
  it("moderates before making a collection public", async () => {
    authed();
    (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, reason: "no" });
    const calls = fakeDb({});
    const res = await PATCH(json({ title: "bad" }), { params: Promise.resolve({ id: COL }) });
    expect(res.status).toBe(422);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("scopes the update to the caller and 404s on someone else's collection", async () => {
    authed();
    (screenRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
    const calls = fakeDb({ collections: [{ data: null, error: null }] });
    const res = await PATCH(json({ visibility: "public" }), { params: Promise.resolve({ id: COL }) });
    expect(res.status).toBe(404);
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["user_id", USER]);
  });

  it("skips moderation for a visibility-only change", async () => {
    authed();
    fakeDb({ collections: [{ data: { id: COL }, error: null }] });
    const res = await PATCH(json({ visibility: "unlisted" }), { params: Promise.resolve({ id: COL }) });
    expect(res.status).toBe(200);
    expect(screenRequest).not.toHaveBeenCalled();
  });
});

describe("POST /api/collections/[id]/items", () => {
  it("rejects another user's private song without revealing it exists", async () => {
    authed();
    const calls = fakeDb({
      collections: [{ data: { id: COL } }],
      jobs: [{ data: { user_id: "someone-else", published_visibility: "private" } }],
    });
    const res = await ADD(json({ jobId: JOB }), { params: Promise.resolve({ id: COL }) });
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.table === "collection_items" && c.op === "insert")).toBe(false);
  });

  it("404s when the collection isn't the caller's", async () => {
    authed();
    fakeDb({ collections: [{ data: null }] });
    expect((await ADD(json({ jobId: JOB }), { params: Promise.resolve({ id: COL }) })).status).toBe(404);
  });

  it("appends a published song after the last position", async () => {
    authed();
    const calls = fakeDb({
      collections: [{ data: { id: COL } }, { data: null }],
      jobs: [{ data: { user_id: "someone-else", published_visibility: "public" } }],
      collection_items: [
        { data: [{ job_id: "a", position: 0 }, { job_id: "b", position: 4 }] },
        { error: null },
      ],
    });
    const res = await ADD(json({ jobId: JOB }), { params: Promise.resolve({ id: COL }) });
    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.table === "collection_items" && c.op === "insert")!;
    expect(insert.args[0]).toMatchObject({ collection_id: COL, job_id: JOB, position: 5 });
  });

  it("is idempotent", async () => {
    authed();
    const calls = fakeDb({
      collections: [{ data: { id: COL } }],
      jobs: [{ data: { user_id: USER, published_visibility: "private" } }],
      collection_items: [{ data: [{ job_id: JOB, position: 0 }] }],
    });
    const res = await ADD(json({ jobId: JOB }), { params: Promise.resolve({ id: COL }) });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});
