import { describe, expect, it } from "vitest";

import { mintEmbedToken } from "../lib/agent/embed-token";

describe("embed token", () => {
  it("is scoped, expiring and never contains the master secret", () => {
    const t = mintEmbedToken("master-secret", 600, 1_000_000_000_000);
    const [v, exp, sig] = t.split(".");
    expect(v).toBe("v1");
    expect(Number(exp)).toBe(1_000_000_000 + 600);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(t).not.toContain("master-secret");
  });
});

describe("job-bound embed token", () => {
  it("is v2.<exp>.<scope>.<sig> and falls back to v1 for an invalid scope", () => {
    const t = mintEmbedToken("master-secret", 600, 1_000_000_000_000, "job-123");
    const [v, exp, scope, sig] = t.split(".");
    expect([v, exp, scope]).toEqual(["v2", String(1_000_000_000 + 600), "job-123"]);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(mintEmbedToken("m", 60, 0, "bad.scope!").startsWith("v1.")).toBe(true);
  });
});
