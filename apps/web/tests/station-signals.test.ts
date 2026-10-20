import { describe, expect, it } from "vitest";

import { parseSignal, rowsToSignals } from "../lib/station/signals";

const id = "41f1e639-1111-4222-8333-444455556666";

describe("parseSignal", () => {
  it("accepts a valid signal", () => {
    expect(parseSignal({ trackId: id, kind: "skip", positionMs: 1200.4 })).toEqual({ trackId: id, kind: "skip", positionMs: 1200 });
  });
  it("rejects bad ids, kinds and positions", () => {
    expect(parseSignal({ trackId: "x", kind: "skip" })).toBeNull();
    expect(parseSignal({ trackId: id, kind: "boost" })).toBeNull();
    expect(parseSignal({ trackId: id, kind: "play", positionMs: -1 })).toBeNull();
    expect(parseSignal(null)).toBeNull();
  });
});

describe("rowsToSignals", () => {
  it("computes age and drops unknown kinds", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const r = rowsToSignals([
      { track_id: id, kind: "like", created_at: "2026-10-18T11:00:00Z" },
      { track_id: id, kind: "weird", created_at: "2026-10-18T11:00:00Z" },
    ], now);
    expect(r).toEqual([{ trackId: id, kind: "like", ageMs: 3_600_000 }]);
  });
});

describe("parseSignal set fields", () => {
  const base = { trackId: "123e4567-e89b-42d3-a456-426614174000", kind: "play" };
  it("accepts a set id and index", () => {
    expect(parseSignal({ ...base, setId: "set3", setIndex: 2 })).toMatchObject({ setId: "set3", setIndex: 2 });
  });
  it("drops a malformed set id and its index instead of rejecting the signal", () => {
    expect(parseSignal({ ...base, setId: "x; drop", setIndex: 2 })).toMatchObject({ setId: null, setIndex: null });
  });
});
