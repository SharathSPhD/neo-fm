/** The listener's wall clock for programming: hour and calendar date, from their IANA timezone when they send one. */
export interface LocalClock {
  hour: number;
  month: number;
  day: number;
}

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Null for anything Intl does not accept as a timezone, so a bad query value falls back instead of throwing. */
function inZone(tz: string, now: number): LocalClock | null {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) && tz !== "UTC") return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", month: "numeric", day: "numeric", hourCycle: "h23",
    }).formatToParts(new Date(now));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const clock = { hour: get("hour"), month: get("month"), day: get("day") };
    return Object.values(clock).every(Number.isInteger) ? clock : null;
  } catch {
    return null;
  }
}

/**
 * Order of trust: a valid timezone, then a bare `hour` (date taken in India, the launch market), then India time.
 * Pure given `now`, so it is testable.
 */
export function resolveClock(tz: string | null, hourParam: string | null, now: number = Date.now()): LocalClock {
  const zoned = tz ? inZone(tz, now) : null;
  if (zoned) return zoned;
  const ist = new Date(now + IST_OFFSET_MS);
  const h = hourParam === null || hourParam === "" ? NaN : Number(hourParam);
  const hour = Number.isInteger(h) && h >= 0 && h <= 23 ? h : ist.getUTCHours();
  return { hour, month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}
