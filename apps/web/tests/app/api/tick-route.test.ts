import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processJobs, sweep } = vi.hoisted(() => ({ processJobs: vi.fn(), sweep: vi.fn() }));
vi.mock("../../../lib/agent/process", () => ({ processJobs }));
vi.mock("../../../lib/agent/adapters", () => ({ serviceClient: () => ({}) }));
vi.mock("../../../lib/agent/sweeper", () => ({ sweepDeps: () => ({}), sweepStuckJobs: sweep }));

import { NextRequest } from "next/server";
import { GET } from "../../../app/api/agent/tick/route";

const req = (auth: string | null = "Bearer s3cret") => new NextRequest("http://x/api/agent/tick", { headers: auth ? { authorization: auth } : {} });
const ENV = ["CRON_SECRET", "AGENT_TICK_SECRET", "GEMINI_API_KEY", "MA_ENVIRONMENT_ID"];

beforeEach(() => {
  processJobs.mockReset().mockResolvedValue({ results: {}, trace: [] });
  sweep.mockReset().mockResolvedValue({});
  process.env.CRON_SECRET = "s3cret"; process.env.GEMINI_API_KEY = "g"; process.env.MA_ENVIRONMENT_ID = "env_abc123";
});
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("GET /api/agent/tick", () => {
  it("rejects a missing or wrong bearer with diagnostics that never echo the secret", async () => {
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "unauthorized", secret_configured: true, bearer_present: true });
    expect(JSON.stringify(body)).not.toContain("s3cret");
    expect((await GET(req(null))).status).toBe(401);
    expect(processJobs).not.toHaveBeenCalled();
  });
  it("accepts either CRON_SECRET or AGENT_TICK_SECRET, tolerating pasted quotes", async () => {
    process.env.AGENT_TICK_SECRET = '"second"';
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
    expect((await GET(req("Bearer second"))).status).toBe(200);
  });
  it("503s with a clear message when the environment is not configured", async () => {
    delete process.env.MA_ENVIRONMENT_ID;
    const a = await GET(req());
    expect(a.status).toBe(503);
    expect((await a.json()).message).toContain("MA_ENVIRONMENT_ID");
    process.env.MA_ENVIRONMENT_ID = "bad";
    expect((await GET(req())).status).toBe(503);
    process.env.MA_ENVIRONMENT_ID = "env_abc123"; delete process.env.GEMINI_API_KEY;
    expect((await GET(req())).status).toBe(503);
    expect(processJobs).not.toHaveBeenCalled();
  });
  it("returns the processing result as JSON", async () => {
    processJobs.mockResolvedValue({ results: { j2: "waiting" }, trace: ["t"] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: { j2: "waiting" }, trace: ["t"], swept: {} });
    expect(processJobs).toHaveBeenCalledWith({ environmentId: "env_abc123", geminiKey: "g" });
  });
  it("sweeps first, then processes", async () => {
    const order: string[] = [];
    sweep.mockImplementation(async () => { order.push("sweep"); return { j1: "failed" }; });
    processJobs.mockImplementation(async () => { order.push("process"); return { results: {}, trace: [] }; });
    const body = await (await GET(req())).json();
    expect(order).toEqual(["sweep", "process"]);
    expect(body.swept).toEqual({ j1: "failed" });
  });
  it("still processes jobs when the sweep throws, and reports the sweep error", async () => {
    sweep.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(processJobs).toHaveBeenCalledOnce();
    expect((await res.json()).swept).toEqual({ sweep_error: "db down" });
  });
  it("500s with tick_failed when processing throws", async () => {
    processJobs.mockRejectedValue(new Error("jobs_query_failed: x"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("tick_failed");
  });
});
