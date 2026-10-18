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
