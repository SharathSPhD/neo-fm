import { describe, expect, it } from "vitest";

import { isTransient } from "../lib/agent/process";

describe("transient error classification", () => {
  it("retries rate limits, 5xx and network blips", () => {
    expect(isTransient(429, "")).toBe(true);
    expect(isTransient(529, "overloaded")).toBe(true);
    expect(isTransient(undefined, "fetch failed")).toBe(true);
    expect(isTransient(undefined, "read ECONNRESET")).toBe(true);
  });
  it("fails fast on client errors and safety refusals", () => {
    expect(isTransient(400, "invalid request")).toBe(false);
    expect(isTransient(undefined, "content_policy: minors")).toBe(false);
  });
});
