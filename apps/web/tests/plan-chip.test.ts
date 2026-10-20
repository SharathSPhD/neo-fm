import { describe, expect, it } from "vitest";

import { showPlanChip } from "../lib/billing/plan-chip";

describe("showPlanChip", () => {
  it("hides FREE when a Station pass is active", () => {
    expect(showPlanChip("Free", true)).toBe(false);
  });
  it("shows FREE without a pass", () => {
    expect(showPlanChip("Free", false)).toBe(true);
  });
  it("shows a paid plan alongside the pass", () => {
    expect(showPlanChip("Pro", true)).toBe(true);
    expect(showPlanChip("Creator", false)).toBe(true);
  });
});
