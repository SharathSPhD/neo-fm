/**
 * GET /api/oembed: public/unlisted songs unfurl; everything else is a uniform 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ row: null as unknown, filters: [] as unknown[][] }));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = (...a: unknown[]) => { state.filters.push(a); return q; };
    q.maybeSingle = async () => ({ data: state.row });
    return { from: () => q };
  },
}));

import { GET } from "@/app/api/oembed/route";

const ID = "abcdefghjk";
const call = (qs: string) => GET(new Request(`https://neo.test/api/oembed?${qs}`));

beforeEach(() => {
  state.row = { public_id: ID, song_documents: { language: "ta", style_family: "carnatic", title: "மழை" } };
  state.filters = [];
});

describe("oembed route", () => {
  it("returns a rich player for a shared song", async () => {
    const res = await call(`url=${encodeURIComponent(`https://neo.test/s/${ID}`)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ type: "rich", version: "1.0", title: "மழை", provider_name: "neo-fm" });
    expect(body.html).toContain(`https://neo.test/s/${ID}/embed`);
    expect(state.filters[0]).toEqual(["published_visibility", ["public", "unlisted"]]);
  });
  it("404s for private, taken-down or unknown songs with an identical body", async () => {
    state.row = null;
    const res = await call(`url=${encodeURIComponent(`https://neo.test/s/${ID}`)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
  it("rejects other hosts, missing url and non-json formats", async () => {
    expect((await call(`url=${encodeURIComponent(`https://evil.test/s/${ID}`)}`)).status).toBe(404);
    expect((await call("")).status).toBe(400);
    expect((await call(`url=${encodeURIComponent(`https://neo.test/s/${ID}`)}&format=xml`)).status).toBe(501);
  });
});
