import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminState = { rows: [] as unknown[], error: null as null | { message: string }, calls: [] as [string, ...unknown[]][], table: "" };
function qb() {
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "order", "limit", "in"]) b[m] = (...a: unknown[]) => { adminState.calls.push([m, ...a]); return b; };
  b.select = (...a: unknown[]) => { adminState.calls.push(["select", ...a]); return b; };
  b.then = (res: (v: unknown) => void) => res({ data: adminState.rows, error: adminState.error, count: adminState.rows.length });
  return b;
}
const inserted: { table: string; row: unknown }[] = [];
let reportJob: { id: string } | null = null;
let reportInsertError: unknown = null;
let poolTrack: { id: string } | null = null;
let openDupes: unknown[] = [];
vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: (table: string) => {
      adminState.table = table;
      if (table === "song_reports") return { select: () => { const c: Record<string, unknown> = {}; c.eq = () => c; c.limit = async () => ({ data: openDupes }); return c; }, insert: async (row: unknown) => { inserted.push({ table, row }); return { error: reportInsertError }; } };
      if (table === "pool_tracks") return { select: () => { const c: Record<string, unknown> = {}; c.eq = () => c; c.maybeSingle = async () => ({ data: poolTrack }); return c; } };
      if (table === "jobs" && adminState.calls.length === 0 && reportMode) return { select: () => ({ eq: () => ({ in: () => ({ maybeSingle: async () => ({ data: reportJob }) }) }) }) };
      return qb();
    },
  }),
}));
let reportMode = false;
let reporterId: string | null = null;
vi.mock("../../../lib/supabase/server", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: reporterId ? { id: reporterId } : null } }) } }) }));

import { NextRequest } from "next/server";
import { POST as report } from "../../../app/api/report/route";
import { GET as adminQ } from "../../../app/api/admin/q/route";

beforeEach(() => { inserted.length = 0; adminState.calls = []; adminState.rows = []; adminState.error = null; reportJob = { id: "job-1" }; poolTrack = { id: TRACK }; reportInsertError = null; openDupes = []; reporterId = null; reportMode = true; process.env.CRON_SECRET = "s3cret"; delete process.env.AGENT_TICK_SECRET; });
afterEach(() => { delete process.env.CRON_SECRET; });

const TRACK = "0a1b2c3d-0000-4000-8000-000000000001";
const rpt = (b: unknown) => new NextRequest("http://x/api/report", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) });

describe("POST /api/report", () => {
  it("rejects bad json, missing id and unknown reasons", async () => {
    expect((await report(rpt("{"))).status).toBe(400);
    expect((await report(rpt({ reason: "other" }))).status).toBe(400);
    expect((await report(rpt({ public_id: "p1", reason: "because" }))).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });
  it("404s for songs that are not public or unlisted", async () => {
    reportJob = null;
    expect((await report(rpt({ public_id: "p1", reason: "copyright" }))).status).toBe(404);
    expect(inserted).toHaveLength(0);
  });
  it("records an anonymous report with the reason and trimmed, length-capped details", async () => {
    const res = await report(rpt({ public_id: "p1", reason: "copyright", details: "  " + "x".repeat(2000) + "  " }));
    expect(res.status).toBe(200);
    const row = inserted[0]!.row as { job_id: string; reporter_id: string | null; reason: string };
    expect(row.job_id).toBe("job-1");
    expect(row.reporter_id).toBeNull();
    expect(row.reason).toBe("copyright: " + "x".repeat(1000));
  });
  it("attributes the report to the signed-in reporter", async () => {
    reporterId = "user-7";
    await report(rpt({ public_id: "p1", reason: "other" }));
    expect((inserted[0]!.row as { reporter_id: string }).reporter_id).toBe("user-7");
    expect((inserted[0]!.row as { reason: string }).reason).toBe("other");
  });
  it("a signed-in re-report of a song with an open report adds nothing", async () => {
    reporterId = "user-7"; openDupes = [{ id: "r1" }];
    const res = await report(rpt({ public_id: "p1", reason: "other" }));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(0);
  });
  it("stores category and details alongside the legacy reason text", async () => {
    await report(rpt({ public_id: "p1", reason: "copyright", details: "same chorus" }));
    expect(inserted[0]!.row).toMatchObject({ reason: "copyright: same chorus", category: "copyright", details: "same chorus" });
  });
  it("500s with report_failed when the insert fails", async () => {
    reportInsertError = { message: "db" };
    expect((await report(rpt({ public_id: "p1", reason: "other" }))).status).toBe(500);
  });
  it("reports a station pool track by track_id", async () => {
    const res = await report(rpt({ track_id: TRACK, reason: "hateful_or_harassing", details: "lyric at 0:20" }));
    expect(res.status).toBe(200);
    expect(inserted[0]!.row).toMatchObject({ pool_track_id: TRACK, category: "hateful_or_harassing", details: "lyric at 0:20" });
    expect(inserted[0]!.row).not.toHaveProperty("job_id");
  });
  it("404s for a pool track that is not admitted and 400s for a non-uuid track_id", async () => {
    poolTrack = null;
    expect((await report(rpt({ track_id: TRACK, reason: "other" }))).status).toBe(404);
    expect((await report(rpt({ track_id: "nope", reason: "other" }))).status).toBe(400);
  });
  it("answers 503 report_unavailable while migration 0110 is not applied", async () => {
    reportInsertError = { code: "42703", message: 'column "pool_track_id" of relation "song_reports" does not exist' };
    const res = await report(rpt({ track_id: TRACK, reason: "other" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "report_unavailable" });
  });
});

const q = (qs: string, auth: string | null = "Bearer s3cret") => new NextRequest(`http://x/api/admin/q?${qs}`, { headers: auth ? { authorization: auth } : {} });

describe("GET /api/admin/q", () => {
  beforeEach(() => { reportMode = false; });
  it("requires the bearer secret", async () => {
    expect((await adminQ(q("table=jobs", null))).status).toBe(401);
    expect((await adminQ(q("table=jobs", "Bearer wrong"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await adminQ(q("table=jobs"))).status).toBe(401);
  });
  it("only reads allow-listed tables (no auth.users, no storage)", async () => {
    for (const t of ["users;drop", "auth.users", "pg_catalog.pg_user", "storage.objects", ""]) {
      const res = await adminQ(q(`table=${encodeURIComponent(t)}`));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("table_not_allowed");
    }
  });
  it("rejects a select that could smuggle SQL-ish syntax", async () => {
    expect((await adminQ(q("table=jobs&select=" + encodeURIComponent("id;select 1")))).status).toBe(400);
    expect((await adminQ(q("table=jobs&select=" + encodeURIComponent("id') or ('1'='1")))).status).toBe(400);
  });
  it("applies filters, ignores unknown operators, and caps the limit at 200", async () => {
    adminState.rows = [{ id: "a" }];
    const res = await adminQ(q("table=jobs&select=id,status&eq.status=completed&evil.col=1&gte.created_at=2026-01-01&order=created_at.desc&limit=99999"));
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([{ id: "a" }]);
    const names = adminState.calls.map((c) => c[0]);
    expect(names).toContain("eq");
    expect(names).toContain("gte");
    expect(adminState.calls.find((c) => c[0] === "limit")).toEqual(["limit", 200]);
    expect(adminState.calls.find((c) => c[0] === "order")).toEqual(["order", "created_at", { ascending: false }]);
    expect(adminState.calls.filter((c) => c[0] === "eq")).toEqual([["eq", "status", "completed"]]);
  });
  it("returns the database error as a 400, not a 500 with a stack", async () => {
    adminState.error = { message: "column nope does not exist" };
    const res = await adminQ(q("table=jobs"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("does not exist");
  });
});
