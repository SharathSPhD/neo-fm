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

export interface AdInventory {
  windowDays: number;
  /** Spot starts in the window (house and sponsor). */
  starts: number;
  startsPerDay: number;
  byLanguage: Record<string, number>;
  byDaypart: Record<string, number>;
  bySlotKind: Record<string, number>;
  /** Modelled value of sponsor-kind starts only (house ads earn nothing), at an assumed CPM in INR. */
  sponsorValueInr: { cpmLow: number; cpmHigh: number; low: number; high: number };
}

/** Listener-local hour to daypart, same boundaries as lib/station/program.ts daypartOf. */
function daypart(hour: number): string {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 16) return "midday";
  if (hour >= 16 && hour < 19) return "evening";
  if (hour >= 19 && hour < 21) return "dusk";
  return "night";
}

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Daypart of a UTC timestamp (ms), read in India time. */
export function daypartOfIst(ms: number): string {
  return daypart(new Date(ms + IST_OFFSET_MS).getUTCHours());
}

/**
 * What the sponsor media kit sells, measured: spot starts by language, daypart (India time) and slot kind over the window,
 * plus the modelled value of sponsor spots at an assumed CPM range. No listener ids; counts only.
 */
export function adInventory(
  slots: { id: string; kind: string; languages: string[] | null }[],
  events: { slot_id: string; event: string; created_at: string }[],
  windowDays: number,
  cpm: { low: number; high: number } = { low: 80, high: 250 },
): AdInventory {
  const byId = new Map(slots.map((s) => [s.id, s]));
  const byLanguage: Record<string, number> = {};
  const byDaypart: Record<string, number> = {};
  const bySlotKind: Record<string, number> = {};
  let starts = 0;
  let sponsorStarts = 0;
  for (const e of events) {
    if (e.event !== "start") continue;
    const t = Date.parse(e.created_at);
    const s = byId.get(e.slot_id);
    if (Number.isNaN(t) || !s) continue;
    starts += 1;
    const lang = s.languages?.[0] ?? "any";
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    const part = daypart(new Date(t + IST_OFFSET_MS).getUTCHours());
    byDaypart[part] = (byDaypart[part] ?? 0) + 1;
    bySlotKind[s.kind] = (bySlotKind[s.kind] ?? 0) + 1;
    if (s.kind === "sponsor") sponsorStarts += 1;
  }
  const value = (c: number) => Math.round((sponsorStarts * c) / 1000);
  return {
    windowDays,
    starts,
    startsPerDay: Math.round((starts / Math.max(1, windowDays)) * 10) / 10,
    byLanguage,
    byDaypart,
    bySlotKind,
    sponsorValueInr: { cpmLow: cpm.low, cpmHigh: cpm.high, low: value(cpm.low), high: value(cpm.high) },
  };
}

export interface PassUpsellStats { slots: number; starts: number; completes: number; taps: number; tapRate: number | null }

/** Station pass creatives (house ads pointing at /pricing), the break ADS_PASS_UPSELL puts after every 3rd break of a session. */
export function passUpsellStats(
  slots: { id: string; kind: string; cta_url?: string | null }[],
  events: { slot_id: string; event: string }[],
): PassUpsellStats {
  const pass = new Set(slots.filter((s) => s.kind === "house" && s.cta_url === "/pricing").map((s) => s.id));
  let starts = 0, completes = 0, taps = 0;
  for (const e of events) {
    if (!pass.has(e.slot_id)) continue;
    if (e.event === "start") starts += 1;
    else if (e.event === "complete") completes += 1;
    else if (e.event === "tap") taps += 1;
  }
  return { slots: pass.size, starts, completes, taps, tapRate: starts > 0 ? Math.round((taps / starts) * 1000) / 1000 : null };
}
