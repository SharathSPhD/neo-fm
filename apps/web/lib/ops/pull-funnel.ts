/**
 * Pull-acquisition funnel for the soft launch: visit, first play, signup, return on day 1 and day 7.
 * Pure. Top-of-funnel counts are anonymous daily counters; activation and returns are per signed-in user, so they cover
 * the signup cohort only. A cohort member only counts toward day N once day N has fully passed (otherwise a young
 * cohort would look like it never returns).
 */

export interface CohortUser { id: string; created_at: string }
export interface ActivityRow { user_id: string; created_at: string }

export interface PullFunnel {
  window_days: number;
  /** Anonymous counters from funnel_daily. */
  visits: number;
  anon_station_plays: number;
  signups: number;
  /** Signups who played a station track or finished a song, ever, since signing up. */
  activated: number;
  returned_d1: { eligible: number; returned: number; rate: number | null };
  returned_d7: { eligible: number; returned: number; rate: number | null };
  rates: {
    visit_to_anon_play: number | null;
    visit_to_signup: number | null;
    signup_to_activated: number | null;
  };
}

const DAY = 86_400_000;
const utcDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

function returnStats(users: CohortUser[], days: Map<string, Set<number>>, n: number, now: number) {
  const today = utcDay(new Date(now).toISOString());
  let eligible = 0;
  let returned = 0;
  for (const u of users) {
    const target = utcDay(u.created_at) + n * DAY;
    if (target >= today) continue; // that day is not over yet
    eligible++;
    if (days.get(u.id)?.has(target)) returned++;
  }
  return { eligible, returned, rate: ratio(returned, eligible) };
}

export function buildPullFunnel(
  cohort: CohortUser[],
  activity: ActivityRow[],
  counters: { visits: number; anonStationPlays: number },
  windowDays: number,
  now = Date.now(),
): PullFunnel {
  const days = new Map<string, Set<number>>();
  const firstActive = new Set<string>();
  const created = new Map(cohort.map((u) => [u.id, utcDay(u.created_at)]));
  for (const a of activity) {
    const signupDay = created.get(a.user_id);
    if (signupDay === undefined) continue;
    const day = utcDay(a.created_at);
    if (day < signupDay) continue; // activity before the account existed cannot happen; ignore clock skew
    (days.get(a.user_id) ?? days.set(a.user_id, new Set()).get(a.user_id)!).add(day);
    firstActive.add(a.user_id);
  }
  return {
    window_days: windowDays,
    visits: counters.visits,
    anon_station_plays: counters.anonStationPlays,
    signups: cohort.length,
    activated: firstActive.size,
    returned_d1: returnStats(cohort, days, 1, now),
    returned_d7: returnStats(cohort, days, 7, now),
    rates: {
      visit_to_anon_play: ratio(counters.anonStationPlays, counters.visits),
      visit_to_signup: ratio(cohort.length, counters.visits),
      signup_to_activated: ratio(firstActive.size, cohort.length),
    },
  };
}
