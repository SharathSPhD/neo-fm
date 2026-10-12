import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const rpc = vi.fn();
vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({ from: () => ({ insert }), rpc }),
}));

import { POST } from "../../../app/api/client-errors/route";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Chrome/120 Safari/537", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/client-errors", () => {
  it("stores a scrubbed row and answers 204", async () => {
    const res = await POST(req({ name: "TypeError", message: "bad for a@b.co", url: "https://x.app/s/smkpb23456?t=1", boundary: "app" }, { "x-request-id": "req-abcdef12" }));
    expect(res.status).toBe(204);
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0]![0];
    expect(row).toMatchObject({ message: "bad for <email>", route: "/s/:id", ua_family: "chrome", request_id: "req-abcdef12", boundary: "app" });
    expect(JSON.stringify(row)).not.toContain("a@b.co");
  });

  it("rejects invalid JSON and invalid shapes with 400, storing nothing", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
    expect((await POST(req({ message: "" }))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await POST(req({ message: "x", stack: "y".repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(insert).not.toHaveBeenCalled();
  });

  it("still answers 204 when storage fails, so clients never retry-storm", async () => {
    insert.mockResolvedValue({ error: { message: "relation does not exist" } });
    expect((await POST(req({ message: "boom" }))).status).toBe(204);
  });

  it("still answers 204 when the service client itself throws", async () => {
    insert.mockRejectedValue(new Error("network"));
    expect((await POST(req({ message: "boom" }))).status).toBe(204);
  });
});
