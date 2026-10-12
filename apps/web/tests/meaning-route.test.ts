import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type Cache = { status: "ok" | "failed"; lines: unknown; created_at: string } | null;
const state = { cache: null as Cache, count: 0, reserve: true as boolean, anthropicText: '["Hello","Rain"]', writes: [] as unknown[], sections: [{ id: "s1", type: "verse", target_seconds: 10, lyrics: "ನಮಸ್ಕಾರ\nಮಳೆ" }] };

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({
    user: { id: USER },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: JOB, user_id: USER, song_documents: { language: "Kannada", document_json: { sections: state.sections } } } }) }) }) }) },
  }),
}));
vi.mock("@/lib/agent/adapters", () => ({
  anthropicClient: () => ({ messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: state.anthropicText }] }) } }),
  serviceClient: () => ({
    rpc: async () => ({ data: state.reserve }),
    from: () => ({
      select: (_c: string, o?: { head?: boolean }) =>
        o?.head
          ? { eq: () => ({ gte: () => ({ neq: async () => ({ count: state.count }) }) }) }
          : { eq: () => ({ maybeSingle: async () => ({ data: state.cache }) }) },
      update: (v: unknown) => { state.writes.push(["update", v]); return { eq: () => ({ eq: async () => ({}) }) }; },
      upsert: async (v: unknown) => { state.writes.push(["upsert", v]); return {}; },
    }),
  }),
}));

import { GET } from "../app/api/songs/[id]/meaning/route";
import { MEANING_DAILY_CAP } from "../lib/lyrics/meaning";

const call = () => GET(new Request("http://x"), { params: { id: JOB } });

beforeEach(() => {
  state.cache = null; state.count = 0; state.reserve = true; state.anthropicText = '["Hello","Rain"]'; state.writes = [];
  state.sections = [{ id: "s1", type: "verse", target_seconds: 10, lyrics: "ನಮಸ್ಕಾರ\nಮಳೆ" }];
});

describe("GET /api/songs/[id]/meaning", () => {
  it("returns the cached translation without calling the model", async () => {
    state.cache = { status: "ok", lines: [{ section_id: "s1", original: "a", roman: "a", english: "A" }], created_at: new Date().toISOString() };
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).cached).toBe(true);
    expect(state.writes).toEqual([]);
  });
  it("negative-caches a recent failure for ten minutes", async () => {
    state.cache = { status: "failed", lines: null, created_at: new Date(Date.now() - 60_000).toISOString() };
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
  it("retries after the failure window", async () => {
    state.cache = { status: "failed", lines: null, created_at: new Date(Date.now() - 11 * 60_000).toISOString() };
    expect((await call()).status).toBe(200);
  });
  it("enforces the per-user daily cap", async () => {
    state.count = MEANING_DAILY_CAP;
    const res = await call();
    expect(res.status).toBe(429);
    expect(state.writes).toEqual([]);
  });
  it("refuses when the shared budget is exhausted", async () => {
    state.reserve = false;
    expect((await call()).status).toBe(503);
  });
  it("stores a failure when the model output cannot be parsed", async () => {
    state.anthropicText = '["only one"]';
    const res = await call();
    expect(res.status).toBe(502);
    expect(JSON.stringify(state.writes)).toContain('"status":"failed"');
  });
  it("stores a good translation and labels it machine translation", async () => {
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.machine_translation).toBe(true);
    expect(body.lines.map((l: { english: string }) => l.english)).toEqual(["Hello", "Rain"]);
    expect(JSON.stringify(state.writes)).toContain('"status":"ok"');
  });
  it("does not call the model or reserve spend for an instrumental song", async () => {
    state.sections = [{ id: "s1", type: "intro", target_seconds: 5, lyrics: "" }];
    state.reserve = false;
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).lines).toEqual([]);
  });
});
