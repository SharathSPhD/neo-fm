import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async () => ({ error: null }));
vi.mock("../../../lib/agent/adapters", () => ({ serviceClient: () => ({ rpc }) }));

const mk = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/events", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }) as never;

beforeEach(() => rpc.mockClear());

describe("POST /api/events", () => {
  it("counts a known event and answers 204", async () => {
    const { POST } = await import("../../../app/api/events/route");
    expect((await POST(mk({ event: "landing_view" }))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("bump_funnel", { p_event: "landing_view" });
  });
  it("counts checkout_started", async () => {
    const { POST } = await import("../../../app/api/events/route");
    expect((await POST(mk({ event: "checkout_started" }))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("bump_funnel", { p_event: "checkout_started" });
  });
  it("does not count when the visitor opted out", async () => {
    const { POST } = await import("../../../app/api/events/route");
    expect((await POST(mk({ event: "landing_view" }, { dnt: "1" }))).status).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects unknown events", async () => {
    const { POST } = await import("../../../app/api/events/route");
    expect((await POST(mk({ event: "x" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
