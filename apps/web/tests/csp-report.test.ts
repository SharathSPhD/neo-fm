import { describe, expect, it } from "vitest";

import { POST } from "../app/api/csp-report/route";
import { summarizeCspReports } from "../lib/csp-report";

describe("csp report", () => {
  it("parses legacy and Reporting API shapes and strips query strings", () => {
    const legacy = { "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://x.test/a.js?token=secret", "document-uri": "https://neo.fm/lib?x=1" } };
    const modern = [{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "inline", documentURL: "https://neo.fm/" } }];
    expect(summarizeCspReports(legacy)).toEqual([{ directive: "script-src-elem", blocked: "https://x.test/a.js", document: "https://neo.fm/lib" }]);
    expect(summarizeCspReports(modern)[0]).toMatchObject({ directive: "img-src", blocked: "inline" });
  });
  it("ignores junk", () => {
    expect(summarizeCspReports("x")).toEqual([]);
    expect(summarizeCspReports([null, 3, {}])).toEqual([]);
  });
  it("always answers 204, even for oversized or malformed bodies", async () => {
    for (const body of ["not json", "x".repeat(20000), "{}"]) {
      const res = await POST(new Request("http://t/api/csp-report", { method: "POST", body }));
      expect(res.status).toBe(204);
    }
  });
});
