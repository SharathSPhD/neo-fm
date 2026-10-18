import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("../../../lib/agent/adapters", () => ({ anthropicClient: () => ({ messages: { create } }) }));

import { POST } from "../../../app/api/admin/moderation-check/route";

const post = (body: unknown, auth?: string) =>
  new NextRequest("http://localhost/api/admin/moderation-check", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  });
const verdict = (allowed: boolean, category: string | null = null) =>
  ({ content: [{ type: "text", text: JSON.stringify({ allowed, category, reason: "x" }) }] });

beforeEach(() => {
  process.env.ADMIN_SECRET = "adm";
  create.mockReset();
});
afterEach(() => {
  delete process.env.ADMIN_SECRET;
});

describe("POST /api/admin/moderation-check", () => {
  it("requires the admin secret and calls no model without it", async () => {
    expect((await POST(post({ prompts: ["a song"] }))).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized batches", async () => {
    expect((await POST(post({ prompts: [] }, "Bearer adm"))).status).toBe(400);
    expect((await POST(post({ prompts: Array(101).fill("a song") }, "Bearer adm"))).status).toBe(400);
  });

  it("returns verdicts by index, uses rules before the model, and honours the prompt override", async () => {
    create.mockResolvedValueOnce(verdict(true)).mockResolvedValueOnce(verdict(false, "defamation"));
    const res = await POST(post({ prompts: ["a song about rain", "sing like Drake", "he is a thief"], system: "OVERRIDE" }, "Bearer adm"));
    const j = await res.json();
    expect(j).toMatchObject({ total: 3, allowed: 1, blocked: 2 });
    expect(j.results[1]).toMatchObject({ allowed: false, layer: "rules", category: "artist_impersonation" });
    expect(j.results[2]).toMatchObject({ allowed: false, layer: "model", category: "defamation" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].system).toBe("OVERRIDE");
    expect(JSON.stringify(j)).not.toContain("rain");
  });
});
