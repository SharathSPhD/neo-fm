/**
 * Server-side I/O for house ads (see lib/station/ads.ts for the rules). Every function treats a missing table or a
 * failed read as "no ads": the queue must keep working before migration 0099 is applied.
 */
import { isLiveSubscriptionStatus } from "@/lib/billing/checkout-guard";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { AD_CAPS, adItem, pickAd, rowToSlot, spotSeconds, type AdContext, type AdItem, type AdSlot } from "./ads";

type Admin = ReturnType<typeof createServiceRoleClient>;
type Rows = { data: Record<string, unknown>[] | null; error?: unknown };

const URL_TTL_SECONDS = 60 * 60;
const DAY_MS = 86_400_000;
const TEN_MIN_MS = 600_000;
/** Stand-in for "tracks since the last break" when there has been none this session. */
const NO_BREAK_YET = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session counters the player sends with each queue request. Untrusted: they can only make ads rarer or more frequent for that listener. */
export interface AdClientState {
  played: number;
  /** Tracks started since the last break; NO_BREAK_YET-sized when none has played. */
  sinceBreak: number;
  lastBreakAgeMs: number | null;
  adSecondsLast10Min: number;
  seen: string[];
}

const int = (v: string | null, max = 10_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : 0;
};

export function parseAdState(sp: URLSearchParams): AdClientState {
  const played = int(sp.get("played"));
  return {
    played,
    // With no previous break the gap rule does not apply; only the "not in the first two tracks" rule does.
    sinceBreak: sp.has("since") ? int(sp.get("since")) : NO_BREAK_YET,
    lastBreakAgeMs: sp.has("adAge") ? int(sp.get("adAge"), 86_400) * 1000 : null,
    adSecondsLast10Min: int(sp.get("adSec"), 600),
    seen: (sp.get("seen") ?? "").split(",").filter((s) => UUID.test(s)).slice(0, 50),
  };
}

async function loadSlots(admin: Admin): Promise<AdSlot[]> {
  try {
    const res = (await (admin.from as unknown as (t: string) => { select: (c: string) => { eq: (k: string, v: boolean) => Promise<Rows> } })("ad_slots")
      .select("*")
      .eq("active", true)) as Rows;
    if (res.error || !res.data) return [];
    return res.data.map(rowToSlot);
  } catch {
    return [];
  }
}

/** Signed-in listeners: what they already heard in the last day, from ad_events (start rows). */
async function loadHistory(admin: Admin, userId: string, slots: AdSlot[], now: number) {
  const out = { adsToday: 0, perCreativeToday: {} as Record<string, number>, lastBreakAgeMs: null as number | null, adSecondsLast10Min: 0 };
  try {
    const since = new Date(now - DAY_MS).toISOString();
    const res = (await (admin.from as unknown as (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { gte: (k: string, v: string) => Promise<Rows> } } };
    })("ad_events").select("slot_id,created_at").eq("user_id", userId).eq("event", "start").gte("created_at", since)) as Rows;
    if (res.error || !res.data) return out;
    const secs = new Map(slots.map((s) => [s.id, spotSeconds(s)]));
    for (const r of res.data) {
      const at = Date.parse(String(r.created_at));
      const id = String(r.slot_id);
      out.adsToday += 1;
      out.perCreativeToday[id] = (out.perCreativeToday[id] ?? 0) + 1;
      const age = now - at;
      if (out.lastBreakAgeMs === null || age < out.lastBreakAgeMs) out.lastBreakAgeMs = age;
      if (age <= TEN_MIN_MS) out.adSecondsLast10Min += secs.get(id) ?? AD_CAPS.cardOnlySeconds;
    }
  } catch { /* no history: client counters only */ }
  return out;
}

/** Creator, Pro and any live subscription are ad-free. Reads fail open to "free" only for signed-out listeners. */
async function isPaid(admin: Admin, userId: string): Promise<boolean> {
  try {
    const [u, b] = await Promise.all([
      (admin.from("users").select("tier").eq("id", userId).maybeSingle()) as unknown as Promise<{ data: { tier?: string } | null }>,
      (admin.from("user_billing").select("status").eq("user_id", userId).maybeSingle()) as unknown as Promise<{ data: { status?: string } | null }>,
    ]);
    return (u.data?.tier ?? "free") !== "free" || isLiveSubscriptionStatus(b.data?.status);
  } catch {
    // Cannot tell: do not serve an ad to someone who might be paying.
    return true;
  }
}

const seenCounts = (seen: string[]) => {
  const m: Record<string, number> = {};
  for (const id of seen) m[id] = (m[id] ?? 0) + 1;
  return m;
};

export interface AdInsertion { item: AdItem; index: number }

/** The break to splice into `tracks`, or null (flag off, paid listener, caps, no eligible slot, tables missing). */
export async function adForQueue(args: {
  admin: Admin;
  userId: string | null;
  state: AdClientState;
  language: string | null;
  hour: number;
  tracks: { tags: string[] }[];
  now?: number;
  nonce?: string;
}): Promise<AdInsertion | null> {
  const { admin, userId, state, language, hour, tracks } = args;
  const now = args.now ?? Date.now();
  if (userId && (await isPaid(admin, userId))) return null;
  const slots = await loadSlots(admin);
  if (slots.length === 0) return null;
  const history = userId ? await loadHistory(admin, userId, slots, now) : null;
  const clientPerCreative = seenCounts(state.seen);
  const perCreativeToday: Record<string, number> = { ...clientPerCreative };
  for (const [id, n] of Object.entries(history?.perCreativeToday ?? {})) perCreativeToday[id] = Math.max(perCreativeToday[id] ?? 0, n);
  const ctx: AdContext = {
    enabled: true,
    paid: false,
    language,
    hour,
    now,
    played: state.played,
    sinceBreak: state.sinceBreak,
    lastBreakAgeMs: [state.lastBreakAgeMs, history?.lastBreakAgeMs ?? null].reduce<number | null>((a, b) => (a === null ? b : b === null ? a : Math.min(a, b)), null),
    adSecondsLast10Min: Math.max(state.adSecondsLast10Min, history?.adSecondsLast10Min ?? 0),
    adsToday: Math.max(state.seen.length, history?.adsToday ?? 0),
    perCreativeToday,
  };
  const placement = pickAd(slots, tracks, ctx);
  if (!placement) return null;
  let url = "";
  if (placement.slot.audioPath) {
    const { data } = await admin.storage.from("tracks").createSignedUrl(placement.slot.audioPath.replace(/^tracks\//, ""), URL_TTL_SECONDS);
    // A spot whose audio cannot be signed is skipped rather than shown silent.
    if (!data?.signedUrl) return null;
    url = data.signedUrl;
  }
  return { item: adItem(placement.slot, url, args.nonce ?? now.toString(36)), index: placement.index };
}
