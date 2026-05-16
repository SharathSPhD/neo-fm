/**
 * Tests for GET /auth/callback (Sprint C bug-a fix).
 *
 * Covers the four important paths:
 *  - happy: ?code=... + valid session exchange -> 303 to ?next=
 *  - sanitization: ?next=https://evil.example -> falls back to /library
 *  - error_description: ?error_description=foo -> 303 to /sign-in with same param
 *  - no code, no error: -> 303 to /sign-in
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import { GET } from "../../app/auth/callback/route";

vi.mock("../../lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "../../lib/supabase/server";

function mockExchange(success: boolean, message?: string) {
  (createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        error: success ? null : { message: message ?? "code expired" },
      }),
    },
  });
}

function makeRequest(query: Record<string, string>) {
  const url = new URL("https://app.neo-fm.test/auth/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to a safe `next`", async () => {
    mockExchange(true);
    const res = await GET(makeRequest({ code: "abc", next: "/songs/new" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.neo-fm.test/songs/new",
    );
  });

  it("falls back to /library when `next` is missing", async () => {
    mockExchange(true);
    const res = await GET(makeRequest({ code: "abc" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.neo-fm.test/library",
    );
  });

  it("sanitizes an absolute-URL `next` back to /library (no open redirect)", async () => {
    mockExchange(true);
    const res = await GET(
      makeRequest({ code: "abc", next: "https://evil.example/" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.neo-fm.test/library",
    );
  });

  it("sanitizes a protocol-relative `next` back to /library", async () => {
    mockExchange(true);
    const res = await GET(
      makeRequest({ code: "abc", next: "//evil.example/" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.neo-fm.test/library",
    );
  });

  it("redirects to /sign-in with error_description on exchange failure", async () => {
    mockExchange(false, "expired link");
    const res = await GET(makeRequest({ code: "abc" }));
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/sign-in");
    expect(loc).toContain("error_description=expired+link");
  });

  it("propagates error_description from query when present", async () => {
    const res = await GET(
      makeRequest({ error_description: "access denied" }),
    );
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/sign-in");
    expect(loc).toContain("error_description=access+denied");
  });

  it("redirects to /sign-in when neither code nor error is present", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.neo-fm.test/sign-in",
    );
  });
});
