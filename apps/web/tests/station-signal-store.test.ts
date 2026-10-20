import { describe, expect, it } from "vitest";

import { insertSignal, type SignalInsertClient } from "../lib/station/signal-store";

const sig = { trackId: "123e4567-e89b-42d3-a456-426614174000", kind: "skip" as const, positionMs: 1200 };

function client(result: () => Promise<{ error: { message: string; code?: string } | null }>) {
  const rows: object[] = [];
  const c: SignalInsertClient = {
    from: (table) => ({
      insert: (row) => {
        expect(table).toBe("station_signals");
        rows.push(row);
        return result();
      },
    }),
  };
  return { c, rows };
}

describe("insertSignal", () => {
  it("writes the row with the listener id and reports ok", async () => {
    const { c, rows } = client(async () => ({ error: null }));
    expect(await insertSignal(c, "u1", sig)).toEqual({ ok: true });
    expect(rows).toEqual([{ user_id: "u1", track_id: sig.trackId, kind: "skip", position_ms: 1200 }]);
  });
  it("reports a returned error instead of swallowing it", async () => {
    const { c } = client(async () => ({ error: { message: "permission denied", code: "42501" } }));
    expect(await insertSignal(c, "u1", sig)).toEqual({ ok: false, reason: "42501" });
  });
  it("reports a thrown error", async () => {
    const { c } = client(async () => { throw new Error("network"); });
    expect(await insertSignal(c, "u1", sig)).toEqual({ ok: false, reason: "network" });
  });
});

describe("insertSignal with a set", () => {
  const withSet = { ...sig, setId: "set2", setIndex: 1 };
  it("stores the set id and place when the columns exist", async () => {
    const { c, rows } = client(async () => ({ error: null }));
    await insertSignal(c, "u1", withSet);
    expect(rows).toEqual([{ user_id: "u1", track_id: sig.trackId, kind: "skip", position_ms: 1200, set_id: "set2", set_index: 1 }]);
  });
  it("falls back to the plain row when migration 0107 is not applied", async () => {
    let n = 0;
    const { c, rows } = client(async () => (n++ === 0 ? { error: { message: "no column", code: "42703" } } : { error: null }));
    expect(await insertSignal(c, "u1", withSet)).toEqual({ ok: true });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ user_id: "u1", track_id: sig.trackId, kind: "skip", position_ms: 1200 });
  });
});
