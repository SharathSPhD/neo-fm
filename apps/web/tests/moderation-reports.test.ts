import { describe, expect, it, vi } from "vitest";

import { reporterOutcome, resendMailer, takedownNotice } from "../lib/email/moderation";
import { listQueue, resolveJobReports } from "../lib/moderation/reports";

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the PostgREST chain the module uses. */
function fakeDb(tables: Record<string, Row[]>, emails: Record<string, string>) {
  const from = (name: string) => {
    let rows = tables[name] ?? [];
    let patch: Row | null = null;
    const q: Record<string, unknown> = {};
    const exec = () => {
      if (patch) { for (const r of rows) Object.assign(r, patch); return { data: null, error: null }; }
      return { data: rows, error: null };
    };
    q.select = () => q;
    q.update = (p: Row) => { patch = p; return q; };
    q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(exec()).then(res);
    return q;
  };
  return {
    from,
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { email: emails[id] } : null } }) } },
  } as never;
}

const seed = () => ({
  jobs: [{ id: "j1", user_id: "owner", public_id: "abc", published_visibility: "public", moderation_status: "ok", song_documents: { title: "Moonlight" } }],
  song_reports: [
    { id: "r1", job_id: "j1", reporter_id: "u1", category: "copyright", details: "x", reason: "copyright: x", status: "open", created_at: "2026-10-12T10:00:00Z" },
    { id: "r2", job_id: "j1", reporter_id: null, category: "other", details: null, reason: "other", status: "open", created_at: "2026-10-12T11:00:00Z" },
    { id: "r3", job_id: "j1", reporter_id: "u1", category: "other", details: null, reason: "other", status: "dismissed", created_at: "2026-10-01T11:00:00Z" },
  ],
});
const emails = { owner: "owner@x.com", u1: "rep@x.com" };

describe("listQueue", () => {
  it("groups open reports per song and ignores resolved ones", async () => {
    const items = await listQueue(fakeDb(seed(), emails));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ job_id: "j1", title: "Moonlight", report_count: 2, categories: ["copyright", "other"] });
  });
  it("is empty when nothing is open", async () => {
    const t = seed(); t.song_reports.forEach((r) => (r.status = "dismissed"));
    expect(await listQueue(fakeDb(t, emails))).toEqual([]);
  });
});

describe("resolveJobReports", () => {
  it("takedown: hides the song, blocks re-publish, closes reports, emails owner and reporter", async () => {
    const t = seed(); const mail = vi.fn(async (_m: { to: string }) => ({ sent: true }));
    const res = await resolveJobReports(fakeDb(t, emails), mail, { jobId: "j1", action: "takedown", note: "confirmed copy" });
    expect(res).toEqual({ ok: true, resolved_reports: 2, notified: { owner: true, reporters: 1 } });
    expect(t.jobs[0]).toMatchObject({ published_visibility: "private", moderation_status: "taken_down", takedown_reason: "confirmed copy" });
    expect(t.song_reports.map((r) => r.status)).toEqual(["actioned", "actioned", "dismissed"]);
    expect(mail.mock.calls.map((c) => c[0].to).sort()).toEqual(["owner@x.com", "rep@x.com"]);
  });
  it("dismiss: leaves the song public and tells reporters only", async () => {
    const t = seed(); const mail = vi.fn(async () => ({ sent: true }));
    await resolveJobReports(fakeDb(t, emails), mail, { jobId: "j1", action: "dismiss" });
    expect(t.jobs[0]).toMatchObject({ published_visibility: "public", moderation_status: "ok" });
    expect(t.song_reports[0]!.status).toBe("dismissed");
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it("reinstate lifts the block without republishing", async () => {
    const t = seed(); t.jobs[0]!.moderation_status = "taken_down"; t.jobs[0]!.published_visibility = "private";
    await resolveJobReports(fakeDb(t, emails), vi.fn(), { jobId: "j1", action: "reinstate" });
    expect(t.jobs[0]).toMatchObject({ moderation_status: "ok", published_visibility: "private" });
  });
  it("a mail failure does not undo or fail the decision", async () => {
    const t = seed();
    const res = await resolveJobReports(fakeDb(t, emails), async () => { throw new Error("resend down"); }, { jobId: "j1", action: "takedown" });
    expect(res.ok).toBe(true);
    expect(t.jobs[0]!.moderation_status).toBe("taken_down");
  });
  it("unknown song -> not_found", async () => {
    expect(await resolveJobReports(fakeDb(seed(), emails), vi.fn(), { jobId: "nope", action: "dismiss" })).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("moderation email", () => {
  it("renders notices", () => {
    expect(takedownNotice({ title: "Moonlight", category: "hateful_or_harassing", note: "n" }).text).toContain("hateful or harassing");
    expect(reporterOutcome({ action: "dismiss" }).text).toContain("info@technektar.com");
  });
  it("dry-runs without a key and posts to Resend with one", async () => {
    expect(await resendMailer({} as never)({ to: "a@b.c", subject: "s", text: "t" })).toEqual({ sent: false });
    const f = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    expect(await resendMailer({ RESEND_API_KEY: "k" } as never, f)({ to: "a@b.c", subject: "s", text: "t" })).toEqual({ sent: true });
    expect(f).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
  });
});
