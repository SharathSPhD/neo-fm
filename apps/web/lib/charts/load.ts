/**
 * Server-side chart loader. Calls the service-role-only chart_songs RPC
 * (migration 0079) and caches for 10 minutes so Discover and the landing
 * page don't re-aggregate on every view. Any failure (including the
 * migration not being applied yet) yields an empty chart, never an error.
 */
import { unstable_cache } from "next/cache";

import { createServiceRoleClient } from "@/lib/supabase/server";

import type { ChartSong } from "./pick";

async function fetchChart(
  lang: string | null,
  days: number,
  limit: number,
): Promise<ChartSong[]> {
  try {
    const { data, error } = await (
      createServiceRoleClient().rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: ChartSong[] | null; error: unknown }>
    )("chart_songs", { p_language: lang, p_days: days, p_limit: limit });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

export function loadChart(
  lang: string | null,
  days = 7,
  limit = 10,
): Promise<ChartSong[]> {
  return unstable_cache(
    () => fetchChart(lang, days, limit),
    ["chart_songs", lang ?? "all", String(days), String(limit)],
    { revalidate: 600 },
  )();
}
