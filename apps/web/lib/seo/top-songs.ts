import { unstable_cache } from "next/cache";

import { prettyStyle } from "@/lib/song/labels";
import { createServiceRoleClient } from "@/lib/supabase/server";

export interface TopSong {
  publicId: string;
  title: string;
  style: string;
  language: string;
  likes: number;
}

type Row = {
  id: string;
  public_id: string;
  song_documents: { title: string | null; language: string; style_family: string } | null;
};

const CANDIDATES = 60;

/** Orders by likes, then recency (the input is already newest first). Stable for equal likes. */
export function rankSongs<T extends { likes: number }>(songs: readonly T[], limit: number): T[] {
  return songs
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.likes - a.s.likes || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

/**
 * Most-liked public songs in one language. Only completed, `public` songs
 * that have a track are considered; unlisted and private songs never
 * appear. The service client is safe because the query restricts to those
 * rows and returns no private columns. Cached so crawlers do not cost a
 * query per hit.
 */
export const loadTopSongs = unstable_cache(
  async (language: string, limit: number): Promise<TopSong[]> => {
    const db = createServiceRoleClient();
    const { data } = await db
      .from("jobs")
      .select("id, public_id, song_documents!inner ( title, language, style_family ), tracks!inner ( id )")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .eq("song_documents.language" as never, language as never)
      .is("dedication_to", null)
      .not("public_id", "is", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(CANDIDATES)
      .returns<Row[]>();
    const rows = data ?? [];
    if (rows.length === 0) return [];

    const counts = new Map<string, number>();
    const { data: likes } = await (db.from("song_likes" as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => Promise<{ data: { job_id: string }[] | null }> };
    })
      .select("job_id")
      .in("job_id", rows.map((r) => r.id));
    for (const l of likes ?? []) counts.set(l.job_id, (counts.get(l.job_id) ?? 0) + 1);

    const songs: TopSong[] = rows
      .filter((r) => r.public_id && r.song_documents)
      .map((r) => ({
        publicId: r.public_id,
        title: r.song_documents!.title?.trim() || `${prettyStyle(r.song_documents!.style_family)} song`,
        style: prettyStyle(r.song_documents!.style_family),
        language: r.song_documents!.language,
        likes: counts.get(r.id) ?? 0,
      }));
    return rankSongs(songs, limit);
  },
  ["seo-top-songs"],
  { revalidate: 600 },
);
