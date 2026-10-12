import { describe, expect, it } from "vitest";

import { AGENT_RUN_COLUMNS, candidateQuery } from "../../../scripts/quality/backfill-query";

const referenced = (url: string): string[] => {
  const u = new URL(url);
  const cols = (u.searchParams.get("select") ?? "").split(",");
  const filtered = [...u.searchParams.keys()].filter((k) => !["select", "order", "limit"].includes(k));
  const sort = (u.searchParams.get("order") ?? "").split(".")[0] ?? "";
  return [...cols, ...filtered, sort];
};

describe("line-timings backfill query", () => {
  it("references only columns that exist on agent_runs", () => {
    const real = new Set<string>(AGENT_RUN_COLUMNS);
    for (const c of referenced(candidateQuery("https://x.supabase.co", 5, false))) expect(real.has(c), c).toBe(true);
  });
  it("adds line_timings only after its migration", () => {
    expect(candidateQuery("https://x", 5, false)).not.toContain("line_timings");
    expect(candidateQuery("https://x", 5, true)).toContain("line_timings=is.null");
  });
  it("sorts by updated_at (agent_runs has no created_at)", () => {
    expect(candidateQuery("https://x", 5, false)).toContain("order=updated_at.desc");
  });
});
