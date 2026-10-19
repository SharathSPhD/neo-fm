import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let row: { audio_path: string } | null = null;
let signed: { signedUrl: string } | null = null;
const filters: [string, unknown][] = [];

vi.mock("@/lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        maybeSingle: async () => ({ data: row }),
      };
      return q;
    },
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: signed && { signedUrl: `${signed.signedUrl}/${p}` } }) }) },
  }),
}));

import { GET } from "../app/api/station/track-url/route";

const ID = "6f1c2c3a-0d3e-4b5a-9c1d-123456789abc";
const call = (id?: string) => GET(new NextRequest(`https://x.test/api/station/track-url${id === undefined ? "" : `?id=${id}`}`));

beforeEach(() => {
  row = null;
  signed = null;
  filters.length = 0;
});

describe("GET /api/station/track-url", () => {
  it("rejects a missing or malformed id", async () => {
    expect((await call()).status).toBe(400);
    expect((await call("../etc")).status).toBe(400);
  });
  it("404s for a track that is not admitted", async () => {
    expect((await call(ID)).status).toBe(404);
    expect(filters).toContainEqual(["status", "admitted"]);
  });
  it("returns a signed Supabase URL for an admitted track", async () => {
    row = { audio_path: "tracks/pool/new_render/a.mp3" };
    signed = { signedUrl: "https://signed" };
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://signed/pool/new_render/a.mp3" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
