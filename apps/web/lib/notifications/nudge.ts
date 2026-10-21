/**
 * Daily "your station is ready" push. Opt-in only: a user is nudged when they have a push subscription AND have
 * switched `station_nudge` push on (default off). Once per UTC day per user, tracked in their prefs row so no
 * migration is needed. Takes its collaborators as arguments for tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadStatedTasteMany } from "../taste/store";
import { sendNative, type FcmConfig } from "./fcm";
import { nudgeTasteEnabled, tasteNudge } from "./nudge-taste";
import { sendPush, type PushConfig, type PushResult } from "./push";
import { NUDGE_LAST_KEY, renderNotification } from "./types";

export const stationNudgeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STATION_NUDGE_ENABLED === "1";

export interface NudgeSummary {
  optedIn: number;
  skippedToday: number;
  sent: number;
  /** Nudges built from a saved taste profile (NUDGE_TASTE), counted when composed. */
  personalised: number;
  failed: number;
  removedSubscriptions: number;
}

const BATCH = 500;

type PrefsRow = { user_id: string; prefs: Record<string, unknown> | null };
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type NativeToken = { id: string; user_id: string; token: string };

/** App (FCM) delivery, off unless a config is passed. */
export interface NudgeNativeOpts {
  cfg: FcmConfig;
  send?: typeof sendNative;
}

/** Language of each user's most recent song; no stored UI language exists server-side, and no migration is needed. */
async function listenerLanguages(db: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data } = await db
      .from("jobs")
      .select("user_id, song_documents(language)")
      .in("user_id", userIds)
      .order("created_at", { ascending: false })
      .limit(userIds.length * 3)
      .returns<{ user_id: string; song_documents: { language: string } | { language: string }[] | null }[]>();
    for (const j of data ?? []) {
      const doc = Array.isArray(j.song_documents) ? j.song_documents[0] : j.song_documents;
      if (doc?.language && !out.has(j.user_id)) out.set(j.user_id, doc.language);
    }
  } catch { /* copy falls back to English */ }
  return out;
}

export async function runStationNudge(
  db: SupabaseClient,
  cfg: PushConfig | null,
  send: typeof sendPush = sendPush,
  now = Date.now(),
  native?: NudgeNativeOpts,
  tasteAware = nudgeTasteEnabled(),
): Promise<NudgeSummary> {
  const out: NudgeSummary = { optedIn: 0, skippedToday: 0, sent: 0, personalised: 0, failed: 0, removedSubscriptions: 0 };
  const today = new Date(now).toISOString().slice(0, 10);

  const { data: rows, error } = await db
    .from("notification_prefs")
    .select("user_id, prefs")
    .eq("prefs->station_nudge->>push", "true")
    .limit(BATCH)
    .returns<PrefsRow[]>();
  if (error || !rows?.length) return out;
  out.optedIn = rows.length;

  const due = rows.filter((r) => {
    const sent = r.prefs?.[NUDGE_LAST_KEY] === today;
    if (sent) out.skippedToday++;
    return !sent;
  });
  if (!due.length) return out;

  const dueIds = due.map((r) => r.user_id);
  const subsByUser = new Map<string, Sub[]>();
  if (cfg) {
    const { data: subRows } = await db
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", dueIds)
      .returns<Sub[]>();
    for (const s of subRows ?? []) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
  }
  // Same opt-in as web push; a missing table (migration 0112 not applied) reads as no tokens.
  const tokensByUser = new Map<string, NativeToken[]>();
  if (native) {
    const { data: tokRows } = await db.from("native_push_tokens").select("id, user_id, token").in("user_id", dueIds).returns<NativeToken[]>();
    for (const t of tokRows ?? []) tokensByUser.set(t.user_id, [...(tokensByUser.get(t.user_id) ?? []), t]);
  }
  const sendApp = native?.send ?? sendNative;

  const langByUser = await listenerLanguages(db, due.map((r) => r.user_id));
  // NUDGE_TASTE=1: copy and deep link follow the saved moods, languages and the daypart. Same opt-in and daily cap as the plain nudge.
  const tasteByUser = tasteAware ? await loadStatedTasteMany(db, dueIds).catch(() => new Map()) : new Map();
  const dead = new Set<string>();
  const deadTokens = new Set<string>();
  for (const r of due) {
    const subs = subsByUser.get(r.user_id) ?? [];
    const tokens = tokensByUser.get(r.user_id) ?? [];
    if (!subs.length && !tokens.length) continue;
    const msg = renderNotification({ type: "station_nudge", data: { lang: langByUser.get(r.user_id) }, count: 1 });
    const results: PushResult[] = [];
    const personal = tasteAware ? tasteNudge(tasteByUser.get(r.user_id) ?? null, langByUser.get(r.user_id), now) : null;
    if (personal) out.personalised++;
    const payload = personal
      ? { title: personal.title, body: personal.body, url: personal.href, tag: "station-nudge" }
      : { title: msg.title, body: msg.body, url: msg.href, tag: "station-nudge" };
    if (cfg) {
      for (const s of subs) {
        const res = await send(cfg, s, payload);
        if (res === "gone") dead.add(s.id);
        results.push(res);
      }
    }
    if (native) {
      for (const t of tokens) {
        const res = await sendApp(native.cfg, t.token, payload);
        if (res === "gone") deadTokens.add(t.id);
        results.push(res);
      }
    }
    if (results.includes("sent")) {
      out.sent++;
      await db
        .from("notification_prefs")
        .update({ prefs: { ...(r.prefs ?? {}), [NUDGE_LAST_KEY]: today } })
        .eq("user_id", r.user_id);
    } else {
      out.failed++;
    }
  }
  if (dead.size) {
    await db.from("push_subscriptions").delete().in("id", [...dead]);
    out.removedSubscriptions = dead.size;
  }
  if (deadTokens.size) {
    await db.from("native_push_tokens").delete().in("id", [...deadTokens]);
    out.removedSubscriptions += deadTokens.size;
  }
  return out;
}
