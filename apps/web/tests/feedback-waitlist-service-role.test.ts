import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
const getUser = vi.fn();
const anonRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ auth: { getUser }, rpc: anonRpc }),
  createServiceRoleClient: () => ({ rpc, from: () => ({ update }) }),
}));

import { POST as postFeedback } from "@/app/api/feedback/route";
import { POST as postWaitlist } from "@/app/api/waitlist/route";

const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }) as never;

describe("anon-facing RPC routes use the service role (0101 revokes anon/authenticated EXECUTE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("feedback calls submit_feedback as service role and attaches the signed-in user", async () => {
    rpc.mockResolvedValue({ data: [{ id: "f1" }], error: null });
    const res = await postFeedback(req({ subject: "s", body: "b" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("submit_feedback", expect.anything());
    expect(anonRpc).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ user_id: "u1" });
  });

  it("waitlist calls join_waitlist as service role", async () => {
    rpc.mockResolvedValue({ data: [{ joined: true, already_on_list: false }], error: null });
    const res = await postWaitlist(req({ email: "a@b.co", tier: "pro" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("join_waitlist", expect.anything());
    expect(anonRpc).not.toHaveBeenCalled();
  });
});
