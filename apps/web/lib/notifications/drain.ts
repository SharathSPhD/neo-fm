/**
 * Sends pending Web Push notifications. Called by the cron route; takes its
 * collaborators as arguments so it can be tested without a network or a DB.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendNative, type FcmConfig } from "./fcm";
import { sendPush, type PushConfig, type PushResult } from "./push";
import { renderNotification, type NotificationRow } from "./types";

export interface DrainSummary {
  considered: number;
  sent: number;
  failed: number;
  expired: number;
  removedSubscriptions: number;
}

const BATCH = 50;
/** A push older than this is stale (the user would rather see it in the bell than get it hours late). */
const MAX_AGE_MS = 60 * 60 * 1000;

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** App (FCM) delivery, off unless a config is passed. */
export interface NativeOpts {
  cfg: FcmConfig;
  send?: typeof sendNative;
}

type NativeToken = { id: string; user_id: string; token: string };

export async function drainPush(
  db: SupabaseClient,
  cfg: PushConfig | null,
  send: typeof sendPush = sendPush,
  now = Date.now(),
  native?: NativeOpts,
): Promise<DrainSummary> {
  const out: DrainSummary = { considered: 0, sent: 0, failed: 0, expired: 0, removedSubscriptions: 0 };
  const { data, error } = await db
    .from("notifications")
    .select("id, user_id, type, data, count, created_at, read_at")
    .eq("push_state", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH)
    .returns<(NotificationRow & { user_id: string })[]>();
  if (error || !data?.length) return out;
  out.considered = data.length;

  const userIds = [...new Set(data.map((n) => n.user_id))];
  const subsByUser = new Map<string, Sub[]>();
  if (cfg) {
    const { data: subRows } = await db
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds)
      .returns<Sub[]>();
    for (const s of subRows ?? []) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
  }
  // A missing table (migration 0112 not applied) reads as no tokens, so web push is never affected by the app path.
  const tokensByUser = new Map<string, NativeToken[]>();
  if (native) {
    const { data: tokRows } = await db.from("native_push_tokens").select("id, user_id, token").in("user_id", userIds).returns<NativeToken[]>();
    for (const t of tokRows ?? []) tokensByUser.set(t.user_id, [...(tokensByUser.get(t.user_id) ?? []), t]);
  }
  const sendApp = native?.send ?? sendNative;

  const dead = new Set<string>();
  const deadTokens = new Set<string>();
  for (const n of data) {
    const stale = now - Date.parse(n.created_at) > MAX_AGE_MS;
    const subs = subsByUser.get(n.user_id) ?? [];
    const tokens = tokensByUser.get(n.user_id) ?? [];
    let state: "sent" | "failed" | "none" = "none";
    if (n.read_at || stale || (subs.length === 0 && tokens.length === 0)) {
      // Already seen in the app, too old, or no device left: nothing to push.
      if (stale && !n.read_at) out.expired++;
    } else {
      const r = renderNotification(n);
      const results: PushResult[] = [];
      const msg = { title: r.title, body: r.body, url: r.href, tag: n.id };
      if (cfg) {
        for (const s of subs) {
          const res = await send(cfg, s, msg);
          if (res === "gone") dead.add(s.id);
          results.push(res);
        }
      }
      if (native) {
        for (const t of tokens) {
          const res = await sendApp(native.cfg, t.token, msg);
          if (res === "gone") deadTokens.add(t.id);
          results.push(res);
        }
      }
      if (results.length) {
        state = results.includes("sent") ? "sent" : "failed";
        if (state === "sent") out.sent++;
        else out.failed++;
      }
    }
    await db.from("notifications").update({ push_state: state }).eq("id", n.id);
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
