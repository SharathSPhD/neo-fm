import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "../../lib/email/send";

const msg = { to: "a@b.c", subject: "s", text: "t" };
afterEach(() => { delete process.env.RESEND_API_KEY; vi.unstubAllGlobals(); });

describe("sendEmail", () => {
  it("is a no-op without RESEND_API_KEY and never calls the network", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await sendEmail(msg)).toEqual({ sent: false, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
  it("sends through Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "m1" }) }); vi.stubGlobal("fetch", f);
    expect(await sendEmail(msg)).toEqual({ sent: true, id: "m1" });
    expect(f.mock.calls[0]![1].headers.authorization).toBe("Bearer re_test");
  });
  it("defaults the sender to neo-fm.com", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "m1" }) }); vi.stubGlobal("fetch", f);
    await sendEmail(msg);
    expect(JSON.parse(f.mock.calls[0]![1].body).from).toBe("neo-fm <noreply@neo-fm.com>");
  });
  it("warns on failure", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    await sendEmail(msg);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("422"));
    warn.mockRestore();
  });
  it("reports failure instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await sendEmail(msg)).toEqual({ sent: false, reason: "failed" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await sendEmail(msg)).toEqual({ sent: false, reason: "failed" });
  });
});
