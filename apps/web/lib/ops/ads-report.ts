/** Per-slot starts, completes and taps for the ads panel on /admin/health (read-only; counts only, no listener ids). */

export interface AdReportRow { slotId: string; headline: string; kind: string; languages: string[]; active: boolean; starts: number; completes: number; taps: number; tapRate: number | null }

interface SlotRow { id: string; headline: string; kind: string; languages: string[] | null; active: boolean }
interface EventRow { slot_id: string; event: string }

export function summarizeAds(slots: SlotRow[], events: EventRow[]): AdReportRow[] {
  const by = new Map<string, { start: number; complete: number; tap: number }>();
  for (const e of events) {
    const c = by.get(e.slot_id) ?? { start: 0, complete: 0, tap: 0 };
    if (e.event === "start" || e.event === "complete" || e.event === "tap") c[e.event] += 1;
    by.set(e.slot_id, c);
  }
  return slots
    .map((s) => {
      const c = by.get(s.id) ?? { start: 0, complete: 0, tap: 0 };
      return {
        slotId: s.id, headline: s.headline, kind: s.kind, languages: s.languages ?? [], active: s.active,
        starts: c.start, completes: c.complete, taps: c.tap,
        tapRate: c.start > 0 ? Math.round((c.tap / c.start) * 1000) / 1000 : null,
      };
    })
    .sort((a, b) => b.starts - a.starts || a.headline.localeCompare(b.headline));
}

export interface Cohort { users: number; returned: number; rate: number | null }
export interface RetentionGuardrail { holdout: Cohort; exposed: Cohort; relativeDropPct: number | null; breach: boolean }

const DAY = 86_400_000;
/** Needs this many listeners in each group before a breach is called; below it the numbers are noise. */
const MIN_COHORT = 30;

/**
 * Next-day return for free signed-in listeners, held-out vs ad-exposed. A listener counts once, from their first play in the window;
 * "returned" means a play 24-48 h after it, so only listeners whose first play is at least 48 h old are included.
 * Breach = exposed return rate more than 10% (relative) below holdout, with enough listeners in both groups. Counts only, no ids out.
 */
export function retentionGuardrail(
  users: { id: string; tier: string }[],
  plays: { user_id: string; created_at: string }[],
  isHoldout: (userId: string) => boolean,
  now: number = Date.now(),
): RetentionGuardrail {
  const free = new Set(users.filter((u) => u.tier === "free").map((u) => u.id));
  const times = new Map<string, number[]>();
  for (const p of plays) {
    if (!free.has(p.user_id)) continue;
    const t = Date.parse(p.created_at);
    if (Number.isNaN(t)) continue;
    const list = times.get(p.user_id) ?? [];
    list.push(t);
    times.set(p.user_id, list);
  }
  const tally = { holdout: { users: 0, returned: 0 }, exposed: { users: 0, returned: 0 } };
  for (const [id, ts] of times) {
    const first = Math.min(...ts);
    if (now - first < 2 * DAY) continue;
    const bucket = isHoldout(id) ? tally.holdout : tally.exposed;
    bucket.users += 1;
    if (ts.some((t) => t >= first + DAY && t < first + 2 * DAY)) bucket.returned += 1;
  }
  const cohort = (c: { users: number; returned: number }): Cohort => ({ ...c, rate: c.users > 0 ? Math.round((c.returned / c.users) * 1000) / 1000 : null });
  const holdout = cohort(tally.holdout);
  const exposed = cohort(tally.exposed);
  const relativeDropPct = holdout.rate && exposed.rate !== null ? Math.round(((holdout.rate - exposed.rate) / holdout.rate) * 1000) / 10 : null;
  const breach = holdout.users >= MIN_COHORT && exposed.users >= MIN_COHORT && relativeDropPct !== null && relativeDropPct > 10;
  return { holdout, exposed, relativeDropPct, breach };
}
