/** Funnel definitions shared by the beacon route, the admin read route and the dashboard. */

export const FUNNEL_EVENTS = [
  "landing_view", "pricing_view", "signup_view", "share_view", "checkout_started",
  // Launch funnel (migration 0096): the station, from first play to share.
  "station_play_anon", "station_play_user", "nudge_shown", "nudge_clicked", "onboarding_done", "listened_3", "station_share", "whatsapp_click",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export function isFunnelEvent(v: unknown): v is FunnelEvent {
  return typeof v === "string" && (FUNNEL_EVENTS as readonly string[]).includes(v);
}

/** Do-Not-Track and Global Privacy Control both mean "do not count me". */
export function optedOut(headers: { get(name: string): string | null }): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

export interface FunnelRow { day: string; event: string; n: number }
export interface FunnelSummary {
  window_days: number;
  views: Record<FunnelEvent, number>;
  /** Derived from existing tables for users who signed up inside the window. */
  signups: number;
  first_song_users: number;
  songs_shared: number;
  /** Songs created in the window that carry a dedication (the gift step). */
  songs_gifted: number;
  /** Window sign-ups whose subscription is active or trialing now. */
  paid_users: number;
  /** Each step as a share of the previous one; null when the previous step is zero. */
  conversion: {
    landing_to_signup_view: number | null; signup_view_to_signup: number | null; signup_to_first_song: number | null;
    /** Upgrade clicks as a share of pricing views. */
    pricing_view_to_checkout: number | null;
    /** Paying users as a share of sign-ups in the window. */
    signup_to_paid: number | null;
  };
  by_day: Record<string, Partial<Record<FunnelEvent, number>>>;
  /** Sign-ups per UTC day inside the window, derived from users.created_at. */
  signups_by_day: Record<string, number>;
}

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

export function buildFunnel(
  rows: FunnelRow[], derived: { signups: number; firstSongUsers: number; shared: number; gifted: number; paidUsers: number; signupDays?: string[] }, windowDays: number,
): FunnelSummary {
  const views = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0])) as Record<FunnelEvent, number>;
  const signupsByDay: Record<string, number> = {};
  for (const d of derived.signupDays ?? []) signupsByDay[d] = (signupsByDay[d] ?? 0) + 1;
  const byDay: FunnelSummary["by_day"] = {};
  for (const r of rows) {
    if (!isFunnelEvent(r.event)) continue;
    views[r.event] += Number(r.n);
    (byDay[r.day] ??= {})[r.event] = Number(r.n);
  }
  return {
    window_days: windowDays,
    views,
    signups: derived.signups,
    first_song_users: derived.firstSongUsers,
    songs_shared: derived.shared,
    songs_gifted: derived.gifted,
    paid_users: derived.paidUsers,
    conversion: {
      landing_to_signup_view: ratio(views.signup_view, views.landing_view),
      signup_view_to_signup: ratio(derived.signups, views.signup_view),
      signup_to_first_song: ratio(derived.firstSongUsers, derived.signups),
      pricing_view_to_checkout: ratio(views.checkout_started, views.pricing_view),
      signup_to_paid: ratio(derived.paidUsers, derived.signups),
    },
    by_day: byDay,
    signups_by_day: signupsByDay,
  };
}
