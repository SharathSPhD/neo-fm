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
