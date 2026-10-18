import { describe, expect, it } from "vitest";

import { STATION_AUDIO_FAILED, STATION_QUEUE_EMPTY, summarizeStation } from "../lib/ops/station-health";

const sig = (user_id: string, kind: string, n = 1) => Array.from({ length: n }, () => ({ user_id, kind }));

describe("summarizeStation", () => {
  it("computes per-listener volume and rates", () => {
    const s = summarizeStation([...sig("a", "play", 6), ...sig("a", "skip", 2), ...sig("b", "play", 4), ...sig("b", "finish", 5)], [], 24);
    expect(s.listeners).toBe(2);
    expect(s.signals_per_listener).toBe(8.5);
    expect(s.skip_rate).toBeCloseTo(0.2);
    expect(s.finish_rate).toBeCloseTo(0.5);
    expect(s.alerts).toEqual([]);
  });

  it("reports nulls on an empty window without alerting", () => {
    const s = summarizeStation([], [], 6);
    expect(s).toMatchObject({ signals: 0, listeners: 0, signals_per_listener: null, skip_rate: null, audio_failure_rate: null, alerts: [] });
  });

  it("alerts on audio failures and empty queues", () => {
    const errs = [...Array(3).fill({ message: STATION_AUDIO_FAILED }), { message: STATION_QUEUE_EMPTY }, { message: "other" }];
    const s = summarizeStation(sig("a", "play", 10), errs, 24);
    expect(s.audio_load_failures).toBe(3);
    expect(s.queue_empty).toBe(1);
    expect(s.audio_failure_rate).toBeCloseTo(3 / 13);
    expect(s.alerts).toHaveLength(2);
  });

  it("does not alert on a handful of plays", () => {
    expect(summarizeStation(sig("a", "play", 3), [{ message: STATION_AUDIO_FAILED }], 24).alerts).toEqual([]);
  });
});
