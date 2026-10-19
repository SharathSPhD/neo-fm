/**
 * Daily "your station is ready" push. Opt-in only: a user is nudged when they have a push subscription AND have
 * switched `station_nudge` push on (default off). Once per UTC day per user, tracked in their prefs row so no
 * migration is needed. Takes its collaborators as arguments for tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendPush, type PushConfig, type PushResult } from "./push";
import { NUDGE_LAST_KEY, renderNotification } from "./types";

export const stationNudgeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STATION_NUDGE_ENABLED === "1";

export interface NudgeSummary {
  optedIn: number;
  skippedToday: number;
  sent: number;
  failed: number;
  removedSubscriptions: number;
}

const BATCH = 500;

type PrefsRow = { user_id: string; prefs: Record<string, unknown> | null };
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

export async function runStationNudge(
  db: SupabaseClient,
  cfg: PushConfig,
  send: typeof sendPush = sendPush,
  now = Date.now(),
): Promise<NudgeSummary> {
  const out: NudgeSummary = { optedIn: 0, skippedToday: 0, sent: 0, failed: 0, removedSubscriptions: 0 };
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

  const { data: subRows } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", due.map((r) => r.user_id))
    .returns<Sub[]>();
  const subsByUser = new Map<string, Sub[]>();
  for (const s of subRows ?? []) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);

  const msg = renderNotification({ type: "station_nudge", data: {}, count: 1 });
  const dead = new Set<string>();
  for (const r of due) {
    const subs = subsByUser.get(r.user_id) ?? [];
    if (!subs.length) continue;
    const results: PushResult[] = [];
    for (const s of subs) {
      const res = await send(cfg, s, { title: msg.title, body: msg.body, url: msg.href, tag: "station-nudge" });
      if (res === "gone") dead.add(s.id);
      results.push(res);
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
  return out;
}
