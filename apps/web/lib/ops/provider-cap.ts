/**
 * Shared per-day request counter for the paid Gemini-family providers (migration 0108, provider_daily_usage).
 * The providers cap requests per day, not pounds: Lyria 3 Pro 500/day on Tier 1, Veo 10/day, TTS 100/day, all resetting at
 * midnight Pacific. The monthly GBP envelopes (spend_ledger) cannot see that, so batch renders (pool, lab, test-render) used
 * the whole day and real users' songs were refused. Hard stops sit at 90% of each cap, and Lyria keeps a user reserve:
 * batch callers stop at 250 of the 450, so at least 200 requests a day are only available to listeners' songs.
 * One call = one provider request, retries included. Fails open when the migration is not applied or the read errors, so a
 * missing table never blocks a song.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CapProvider = "lyria" | "veo" | "tts";
export type CallClass = "user" | "batch";

export interface DailyLimits { total: number; batch: number }

const DEFAULTS: Record<CapProvider, DailyLimits> = {
  lyria: { total: 450, batch: 250 },
  veo: { total: 9, batch: 9 },
  tts: { total: 90, batch: 90 },
};

function intEnv(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** `LYRIA_DAILY_CAP` / `LYRIA_BATCH_DAILY_CAP` (and VEO_, TTS_) override the defaults. */
export function dailyLimits(provider: CapProvider, env: Record<string, string | undefined> = process.env): DailyLimits {
  const p = provider.toUpperCase();
  const d = DEFAULTS[provider];
  const total = intEnv(env[`${p}_DAILY_CAP`], d.total);
  return { total, batch: Math.min(intEnv(env[`${p}_BATCH_DAILY_CAP`], d.batch), total) };
}

/** What the provider's own day is: Pacific time, matching the midnight PT reset. */
export function providerDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface DailyCap {
  /** Count one provider request; false when today's cap for this class is spent. */
  reserve(): Promise<boolean>;
}

export function dailyCap(db: Pick<SupabaseClient, "rpc">, provider: CapProvider, cls: CallClass, env: Record<string, string | undefined> = process.env): DailyCap {
  const lim = dailyLimits(provider, env);
  return {
    async reserve() {
      try {
        const { data, error } = await db.rpc("reserve_provider_call", { p_provider: provider, p_bucket: cls, p_total_cap: lim.total, p_batch_cap: lim.batch });
        if (error) return true;
        return data !== false;
      } catch {
        return true;
      }
    },
  };
}

export interface DailyUsage { provider: CapProvider; day: string; user: number; batch: number; limits: DailyLimits }

/** Today's counts, for the ops views and for scripts that want to check before starting a batch. */
export async function dailyUsage(db: Pick<SupabaseClient, "from">, provider: CapProvider, env: Record<string, string | undefined> = process.env): Promise<DailyUsage> {
  const day = providerDay();
  let user = 0;
  let batch = 0;
  try {
    const { data } = await (db.from as unknown as (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => Promise<{ data: { bucket: string; n: number }[] | null }> } } })("provider_daily_usage")
      .select("bucket,n").eq("provider", provider).eq("day", day);
    for (const r of data ?? []) { if (r.bucket === "user") user = r.n; else if (r.bucket === "batch") batch = r.n; }
  } catch { /* table missing: report zeros */ }
  return { provider, day, user, batch, limits: dailyLimits(provider, env) };
}
