import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/alexa/tracks", () => ({ poolTrackSource: { next: vi.fn(), byId: vi.fn() } }));

import { POST } from "../app/api/alexa/route";

const req = (body = "{}") => new NextRequest("http://localhost/api/alexa", { method: "POST", body });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/alexa", () => {
  it("is a 404 unless ALEXA_SKILL_ENABLED=1", async () => {
    expect((await POST(req())).status).toBe(404);
  });

  it("rejects a request that lacks Alexa's signature headers", async () => {
    vi.stubEnv("ALEXA_SKILL_ENABLED", "1");
    vi.stubEnv("ALEXA_SKILL_ID", "amzn1.ask.skill.test");
    expect((await POST(req())).status).toBe(400);
  });
});
