/** Sleep timer for the continuous player: stop at the end of the current song once the chosen time has passed. */

export const SLEEP_MINUTES = [15, 30, 60] as const;
export type SleepMinutes = (typeof SLEEP_MINUTES)[number];

export function sleepEndsAt(minutes: SleepMinutes, now: number): number {
  return now + minutes * 60_000;
}

export function sleepDue(endsAt: number | null, now: number): boolean {
  return endsAt !== null && now >= endsAt;
}

/** Whole minutes left, rounded up so "1" shows until the last second; 0 once due. */
export function sleepMinutesLeft(endsAt: number | null, now: number): number {
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 60_000));
}
