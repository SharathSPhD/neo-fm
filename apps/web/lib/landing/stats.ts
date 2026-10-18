import { unstable_cache } from "next/cache";

import { createServiceRoleClient } from "@/lib/supabase/server";

export interface CommunityStats {
  songs: number;
  languages: number;
}

/** Below this many public songs the numbers undersell the product, so the landing page leaves them out. */
export const MIN_SONGS_TO_SHOW = 25;

export function shouldShowStats(s: CommunityStats | null): s is CommunityStats {
  return !!s && s.songs >= MIN_SONGS_TO_SHOW && s.languages >= 2;
}

const load = unstable_cache(
  async (): Promise<CommunityStats | null> => {
    const { data } = await createServiceRoleClient()
      .from("jobs")
      .select("song_documents!inner ( language ), tracks!inner ( id )")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .limit(2000)
      .returns<{ song_documents: { language: string } | null }[]>();
    if (!data) return null;
    return { songs: data.length, languages: new Set(data.map((r) => r.song_documents?.language).filter(Boolean)).size };
  },
  ["landing-community-stats"],
  { revalidate: 600 },
);

export async function loadCommunityStats(): Promise<CommunityStats | null> {
  return load().catch(() => null);
}
