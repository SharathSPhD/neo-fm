import { describe, expect, it } from "vitest";

import { buildRow, ClientErrorSchema, fingerprintOf, uaFamily } from "../../lib/obs/client-error";
import { groupClientErrors, type StoredClientError } from "../../lib/obs/group-errors";

describe("ClientErrorSchema", () => {
  it("accepts a minimal report and defaults the boundary", () => {
    const r = ClientErrorSchema.parse({ message: "x" });
    expect(r.boundary).toBe("window");
  });
  it.each([{}, { message: "" }, { message: "x", boundary: "nope" }, { message: "x", lang: "fr" }, { message: "x".repeat(1001) }])("rejects %j", (bad) => {
    expect(ClientErrorSchema.safeParse(bad).success).toBe(false);
  });
});

describe("buildRow", () => {
  it("scrubs every free-text field and keeps only the path and browser family", () => {
    const row = buildRow(
      ClientErrorSchema.parse({
        name: "TypeError",
        message: "Cannot read x for jane@example.com",
        stack: "TypeError: x\n    at f (https://neo-fm.app/_next/a.js?sig=zzz:1:2)",
        url: "https://neo-fm.app/s/smkpb23456?token=secret",
        boundary: "root",
        lang: "hi",
      }),
      { userAgent: "Mozilla/5.0 (iPhone) AppleWebKit Version/17 Mobile Safari/604.1", requestId: "req-abcdef12" },
    );
    expect(row.message).toBe("Cannot read x for <email>");
    expect(row.route).toBe("/s/:id");
    expect(row.ua_family).toBe("safari-mobile");
    expect(row.request_id).toBe("req-abcdef12");
    expect(JSON.stringify(row)).not.toMatch(/jane@|secret|sig=zzz|neo-fm\.app/);
  });
});

describe("fingerprintOf", () => {
  it("groups the same bug across different numbers, separates different bugs", () => {
    const a = fingerprintOf("TypeError", "item 12 missing", "x\n    at f (a.js:10:5)");
    const b = fingerprintOf("TypeError", "item 99 missing", "x\n    at f (a.js:11:7)");
    const c = fingerprintOf("RangeError", "item 12 missing", "x\n    at f (a.js:10:5)");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("uaFamily", () => {
  it.each([
    [null, "unknown"],
    ["Mozilla/5.0 Chrome/120 Safari/537", "chrome"],
    ["Mozilla/5.0 Firefox/120", "firefox"],
    ["Mozilla/5.0 Chrome/120 Safari/537 Edg/120", "edge"],
  ])("%s -> %s", (ua, want) => expect(uaFamily(ua)).toBe(want));
});

describe("groupClientErrors", () => {
  const row = (fp: string, at: string, rid: string | null = null): StoredClientError => ({
    created_at: at, fingerprint: fp, name: "E", message: fp, route: "/", boundary: "app", lang: null, ua_family: "chrome", request_id: rid,
  });
  it("counts per fingerprint, most frequent first, tracking first/last seen", () => {
    const g = groupClientErrors([row("a", "2026-01-01T10:00:00Z"), row("b", "2026-01-01T11:00:00Z"), row("a", "2026-01-01T12:00:00Z", "r2"), row("a", "2026-01-01T09:00:00Z")]);
    expect(g.map((x) => x.fingerprint)).toEqual(["a", "b"]);
    expect(g[0]).toMatchObject({ count: 3, first_seen: "2026-01-01T09:00:00Z", last_seen: "2026-01-01T12:00:00Z", sample_request_id: "r2" });
  });
});
