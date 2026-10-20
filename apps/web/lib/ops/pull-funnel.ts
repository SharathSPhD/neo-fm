/**
 * Pull-acquisition funnel for the soft launch: visit, first play, signup, return on day 1 and day 7.
 * Pure. Top-of-funnel counts are anonymous daily counters; activation and returns are per signed-in user, so they cover
 * the signup cohort only. A cohort member only counts toward day N once day N has fully passed (otherwise a young
 * cohort would look like it never returns).
 */

export interface CohortUser { id: string; created_at: string }
/** `language` is the language of the track played or song made, when known. */
export interface ActivityRow {
  user_id: string;
  created_at: string;
  language?: string | null;
  /** Listening this row proves, in ms: a finished track counts its full length, a skip or replay the position reached. */
  listen_ms?: number;
  /** True for a share signal. */
  shared?: boolean;
}

/** A user counts as a 5-minute listener once their summed listening reaches this. */
export const FIVE_MINUTES_MS = 300_000;

export interface ReturnRate { eligible: number; returned: number; rate: number | null }
/** Activated users grouped by the language of their first activity, with how many came back. */
export interface LanguageActivation {
  language: string;
  activated: number;
  returned_d1: ReturnRate;
  returned_d7: ReturnRate;
  listened_5min: number;
}

export interface PullFunnel {
  window_days: number;
  /** Anonymous counters from funnel_daily. */
  visits: number;
  anon_station_plays: number;
  signups: number;
  /** Signups who played a station track or finished a song, ever, since signing up. */
  activated: number;
  /** Activated signups whose summed listening reached five minutes. */
  listened_5min: number;
  /** Activated signups who shared a track from the station. */
  shared: number;
  returned_d1: ReturnRate;
  returned_d7: ReturnRate;
  /** Activated users by first-activity language, biggest first; "unknown" when no activity named a language. */
  by_language: LanguageActivation[];
  rates: {
    visit_to_anon_play: number | null;
    visit_to_signup: number | null;
    signup_to_activated: number | null;
    activated_to_listened_5min: number | null;
    activated_to_shared: number | null;
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
  const listenMs = new Map<string, number>();
  const sharers = new Set<string>();
  const firstLanguage = new Map<string, { at: string; language: string }>();
  const created = new Map(cohort.map((u) => [u.id, utcDay(u.created_at)]));
  for (const a of activity) {
    const signupDay = created.get(a.user_id);
    if (signupDay === undefined) continue;
    const day = utcDay(a.created_at);
    if (day < signupDay) continue; // activity before the account existed cannot happen; ignore clock skew
    (days.get(a.user_id) ?? days.set(a.user_id, new Set()).get(a.user_id)!).add(day);
    firstActive.add(a.user_id);
    if (a.listen_ms) listenMs.set(a.user_id, (listenMs.get(a.user_id) ?? 0) + a.listen_ms);
    if (a.shared) sharers.add(a.user_id);
    if (a.language) {
      const seen = firstLanguage.get(a.user_id);
      if (!seen || a.created_at < seen.at) firstLanguage.set(a.user_id, { at: a.created_at, language: a.language });
    }
  }
  const groups = new Map<string, CohortUser[]>();
  for (const u of cohort) {
    if (!firstActive.has(u.id)) continue;
    const language = firstLanguage.get(u.id)?.language ?? "unknown";
    (groups.get(language) ?? groups.set(language, []).get(language)!).push(u);
  }
  const listened = (users: CohortUser[]) => users.filter((u) => (listenMs.get(u.id) ?? 0) >= FIVE_MINUTES_MS).length;
  const byLanguage = [...groups]
    .map(([language, users]) => ({
      language,
      activated: users.length,
      returned_d1: returnStats(users, days, 1, now),
      returned_d7: returnStats(users, days, 7, now),
      listened_5min: listened(users),
    }))
    .sort((a, b) => b.activated - a.activated || a.language.localeCompare(b.language));
  return {
    window_days: windowDays,
    visits: counters.visits,
    anon_station_plays: counters.anonStationPlays,
    signups: cohort.length,
    activated: firstActive.size,
    listened_5min: listened(cohort.filter((u) => firstActive.has(u.id))),
    shared: cohort.filter((u) => firstActive.has(u.id) && sharers.has(u.id)).length,
    returned_d1: returnStats(cohort, days, 1, now),
    returned_d7: returnStats(cohort, days, 7, now),
    by_language: byLanguage,
    rates: {
      visit_to_anon_play: ratio(counters.anonStationPlays, counters.visits),
      visit_to_signup: ratio(cohort.length, counters.visits),
      signup_to_activated: ratio(firstActive.size, cohort.length),
      activated_to_listened_5min: ratio(listened(cohort.filter((u) => firstActive.has(u.id))), firstActive.size),
      activated_to_shared: ratio(cohort.filter((u) => firstActive.has(u.id) && sharers.has(u.id)).length, firstActive.size),
    },
  };
}
