import { describe, expect, it } from "vitest";

import { listeningReport, MIN_LISTENERS } from "../lib/ops/listening-report";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 21, h, m)).toISOString();
const lang = new Map([["t1", "kn"], ["t2", "kn"], ["t3", "hi"]]);

/** n listeners, each: play t1 at 04:00Z (09:30 IST, morning), skip it 2 min later, play t2 at 04:05, then pause > 30 min, play t3 at 06:00Z. */
function listeners(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = `u${i}`;
    out.push({ user_id: u, track_id: "t1", kind: "play", created_at: at(4, 0) });
    out.push({ user_id: u, track_id: "t1", kind: "skip", created_at: at(4, 2) });
    out.push({ user_id: u, track_id: "t2", kind: "play", created_at: at(4, 5) });
    out.push({ user_id: u, track_id: "t3", kind: "play", created_at: at(6, 0) });
  }
  return out;
}

describe("listeningReport", () => {
  it("splits sessions on a 30 minute pause and computes the metrics", () => {
    const r = listeningReport(listeners(MIN_LISTENERS), lang, [], [], 7);
    expect(r.overall.suppressed).toBe(false);
    expect(r.overall.sessions).toBe(MIN_LISTENERS * 2);
    expect(r.overall.plays).toBe(MIN_LISTENERS * 3);
    expect(r.overall.skip_rate).toBeCloseTo(1 / 3, 3);
    expect(r.overall.tracks_per_session).toBe(1.5);
    // first session 5 min long, second is a single signal (no measurable length)
    expect(r.overall.avg_session_minutes).toBe(5);
    expect(r.by_language.kn!.listeners).toBe(MIN_LISTENERS);
    expect(r.by_daypart.morning!.skip_rate).toBeCloseTo(1 / 3, 3);
  });

  it("suppresses cells under the listener threshold and exposes no ids", () => {
    const rows = [...listeners(MIN_LISTENERS), { user_id: "lone", track_id: "t4", kind: "play", created_at: at(20, 0) }];
    const r = listeningReport(rows, new Map([...lang, ["t4", "ta"]]), [], [], 7);
    expect(r.by_language.ta!.suppressed).toBe(true);
    expect(r.by_language.ta!.plays).toBeNull();
    expect(r.by_language.ta!.listeners).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/lone|u0|t4/);
  });

  it("suppresses everything with too few listeners", () => {
    const r = listeningReport(listeners(MIN_LISTENERS - 1), lang, [], [], 7);
    expect(r.overall.suppressed).toBe(true);
    expect(r.overall.skip_rate).toBeNull();
  });

  it("computes ad-break completion by language and daypart", () => {
    const slots = [{ id: "s1", languages: ["kn"] }, { id: "s2", languages: [] }];
    const ev = [
      { slot_id: "s1", event: "start", created_at: at(4, 10) },
      { slot_id: "s1", event: "complete", created_at: at(4, 10) },
      { slot_id: "s1", event: "start", created_at: at(4, 20) },
      { slot_id: "s2", event: "start", created_at: at(4, 30) },
      { slot_id: "s2", event: "tap", created_at: at(4, 30) },
    ];
    const r = listeningReport(listeners(MIN_LISTENERS), lang, ev, slots, 7);
    expect(r.overall.ad_starts).toBe(3);
    expect(r.overall.ad_completion_rate).toBeCloseTo(1 / 3, 3);
    expect(r.by_language.kn!.ad_completion_rate).toBe(0.5);
    expect(r.by_daypart.morning!.ad_starts).toBe(3);
  });
<<<<<<< HEAD

  it("splits Free listeners by ad holdout arm and leaves others out", () => {
    const rows = listeners(MIN_LISTENERS * 2);
    const arm = (u: string) => (Number(u.slice(1)) < MIN_LISTENERS ? "holdout" : Number(u.slice(1)) < MIN_LISTENERS * 2 - 1 ? "exposed" : null);
    const r = listeningReport(rows, lang, [], [], 7, arm);
    expect(r.by_arm.holdout!.listeners).toBe(MIN_LISTENERS);
    expect(r.by_arm.holdout!.suppressed).toBe(false);
    expect(r.by_arm.exposed!.listeners).toBe(MIN_LISTENERS - 1);
    expect(r.by_arm.exposed!.suppressed).toBe(true);
    expect(listeningReport(rows, lang, [], [], 7).by_arm).toEqual({});
  });
});

=======
});
>>>>>>> origin/main
