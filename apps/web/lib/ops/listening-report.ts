/**
 * Listening-time analytics for the sponsor media kit: session length, tracks per session, skip rate and ad-break
 * completion by language and daypart. Pure aggregation; the route only fetches rows and hands them here.
 * Privacy: output is counts and averages only (no user or track ids), and any cell with fewer than MIN_LISTENERS distinct
 * listeners is suppressed (metrics null) so a quiet cell never describes one person.
 */
import { daypartOfIst } from "./ads-report";

export const MIN_LISTENERS = 5;
/** A pause longer than this ends a listening session. */
export const SESSION_GAP_MS = 30 * 60_000;

export interface ListeningSignal { user_id: string; track_id: string; kind: string; created_at: string }
export interface ListeningAdEvent { slot_id: string; event: string; created_at: string }
export interface ListeningAdSlot { id: string; languages: string[] | null }

export interface ListeningCell {
  listeners: number;
  sessions: number | null;
  avg_session_minutes: number | null;
  median_session_minutes: number | null;
  tracks_per_session: number | null;
  plays: number | null;
  skip_rate: number | null;
  ad_starts: number | null;
  ad_completion_rate: number | null;
  suppressed: boolean;
}
export interface ListeningReport {
  window_days: number;
  min_listeners: number;
  overall: ListeningCell;
  by_language: Record<string, ListeningCell>;
  by_daypart: Record<string, ListeningCell>;
  /** Free signed-in listeners split by the ad holdout: "holdout" hears no ads, "exposed" hears breaks (and the pass upsell). Empty without an arm lookup. */
  by_arm: Record<string, ListeningCell>;
  /** Ad starts and completes carry no listener ids, so ad cells are keyed by the slot's first language ("any" if none). */
  notes: string[];
}

interface Session { user: string; startMs: number; endMs: number; plays: number; language: string }
interface Bucket { users: Set<string>; sessions: Session[]; plays: number; skips: number; adStarts: number; adCompletes: number }

const bucket = (): Bucket => ({ users: new Set(), sessions: [], plays: 0, skips: 0, adStarts: 0, adCompletes: 0 });
const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function cell(b: Bucket): ListeningCell {
  const listeners = b.users.size;
  if (listeners < MIN_LISTENERS) {
    return { listeners, sessions: null, avg_session_minutes: null, median_session_minutes: null, tracks_per_session: null, plays: null, skip_rate: null, ad_starts: null, ad_completion_rate: null, suppressed: true };
  }
  // A session with one signal has no measurable length; it still counts toward tracks per session.
  const lengths = b.sessions.filter((s) => s.endMs > s.startMs).map((s) => (s.endMs - s.startMs) / 60_000);
  return {
    listeners,
    sessions: b.sessions.length,
    avg_session_minutes: lengths.length ? round1(lengths.reduce((a, x) => a + x, 0) / lengths.length) : null,
    median_session_minutes: lengths.length ? round1(median(lengths)!) : null,
    tracks_per_session: b.sessions.length ? round1(b.sessions.reduce((a, s) => a + s.plays, 0) / b.sessions.length) : null,
    plays: b.plays,
    skip_rate: ratio(b.skips, b.plays),
    ad_starts: b.adStarts,
    ad_completion_rate: ratio(b.adCompletes, b.adStarts),
    suppressed: false,
  };
}

export function listeningReport(
  signals: ListeningSignal[],
  trackLanguage: Map<string, string>,
  adEvents: ListeningAdEvent[],
  adSlots: ListeningAdSlot[],
  windowDays: number,
  armOf: (userId: string) => "exposed" | "holdout" | null = () => null,
): ListeningReport {
  const overall = bucket();
  const langs = new Map<string, Bucket>();
  const parts = new Map<string, Bucket>();
  const arms = new Map<string, Bucket>();
  const get = (m: Map<string, Bucket>, k: string) => { let b = m.get(k); if (!b) { b = bucket(); m.set(k, b); } return b; };

  const byUser = new Map<string, { t: number; kind: string; lang: string }[]>();
  for (const s of signals) {
    const t = Date.parse(s.created_at);
    if (Number.isNaN(t)) continue;
    let list = byUser.get(s.user_id);
    if (!list) { list = []; byUser.set(s.user_id, list); }
    list.push({ t, kind: s.kind, lang: trackLanguage.get(s.track_id) ?? "unknown" });
  }

  for (const [user, list] of byUser) {
    const arm = armOf(user);
    list.sort((a, b) => a.t - b.t);
    let cur: (Session & { langs: Map<string, number> }) | null = null;
    const close = () => {
      if (!cur) return;
      let best = "unknown";
      let n = -1;
      for (const [l, c] of cur.langs) if (c > n) { best = l; n = c; }
      const session: Session = { user, startMs: cur.startMs, endMs: cur.endMs, plays: cur.plays, language: best };
      if (session.plays > 0) {
        overall.sessions.push(session);
        get(langs, session.language).sessions.push(session);
        get(parts, daypartOfIst(session.startMs)).sessions.push(session);
        if (arm) get(arms, arm).sessions.push(session);
      }
      cur = null;
    };
    for (const e of list) {
      if (cur && e.t - cur.endMs > SESSION_GAP_MS) close();
      if (!cur) cur = { user, startMs: e.t, endMs: e.t, plays: 0, language: "", langs: new Map() };
      cur.endMs = e.t;
      if (e.kind === "play") {
        cur.plays += 1;
        cur.langs.set(e.lang, (cur.langs.get(e.lang) ?? 0) + 1);
      }
      if (e.kind === "play" || e.kind === "skip") {
        const targets = [overall, get(langs, e.lang), get(parts, daypartOfIst(e.t))];
        if (arm) targets.push(get(arms, arm));
        for (const b of targets) {
          b.users.add(user);
          if (e.kind === "play") b.plays += 1; else b.skips += 1;
        }
      }
    }
    close();
  }

  // Ad events have no listener ids in this report, so ad rates are only shown for cells that already clear the
  // listener threshold on the listening side (the cell gate protects them).
  const slotLang = new Map(adSlots.map((s) => [s.id, s.languages?.[0] ?? "any"]));
  for (const e of adEvents) {
    if (e.event !== "start" && e.event !== "complete") continue;
    const t = Date.parse(e.created_at);
    if (Number.isNaN(t)) continue;
    const targets = [overall, get(parts, daypartOfIst(t))];
    const lang = slotLang.get(e.slot_id);
    if (lang) targets.push(get(langs, lang));
    for (const b of targets) { if (e.event === "start") b.adStarts += 1; else b.adCompletes += 1; }
  }

  const out = (m: Map<string, Bucket>) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, b]) => [k, cell(b)]));
  return {
    window_days: windowDays,
    min_listeners: MIN_LISTENERS,
    overall: cell(overall),
    by_language: out(langs),
    by_daypart: out(parts),
    by_arm: out(arms),
    notes: [
      `Cells with fewer than ${MIN_LISTENERS} distinct listeners are suppressed.`,
      "A session ends after a 30 minute pause. Session length runs from the first to the last play or skip signal, so it undercounts the final track.",
      "Session language is the language of most of its plays. Daypart is India time at the session start (skips and plays use their own time).",
      "by_arm compares Free signed-in listeners held out from ads with those who hear them; ad cells do not apply to the holdout.",
      "Ad cells by language use the slot's first language; house ads for any language count under 'any' and in overall and daypart only.",
    ],
  };
}
