/**
 * Landing-page language samples: one real, public, playable community song per launch language,
 * with its first lyric lines in the song's own script. Pure helpers live here so they are unit-tested;
 * `loadLanguageSamples` is the cached database read.
 */
import { unstable_cache } from "next/cache";

import { EXAMPLE_IDEAS } from "@/lib/first-run/examples";
import { HERO_LANGS, type LanguageSample } from "./langs";
import { loadPool } from "@/lib/station/pool";
import { createServiceRoleClient } from "@/lib/supabase/server";

type SectionLike = { type?: string; lyrics?: string | null };

/** First `max` real lyric lines: no section tags, markdown headings, bold markers or blank lines. */
export function previewLines(sections: readonly SectionLike[] | null | undefined, max = 4): string[] {
  const out: string[] = [];
  for (const s of sections ?? []) {
    if (!s?.lyrics || s.type === "instrumental") continue;
    for (const raw of s.lyrics.split(/\r?\n/)) {
      const line = raw.replace(/\*+/g, "").trim();
      if (!line || /^[[#(<]/.test(line) || /^title\s*:/i.test(line)) continue;
      out.push(line);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export interface SongRow {
  public_id: string;
  song_documents: {
    title: string | null;
    language: string;
    document_json: { sections?: SectionLike[] } | null;
  } | null;
}

/** Newest-first rows in, one sample per hero language out. Rows without lyric lines are skipped. `poolLangs` are the languages with an admitted station track. */
export function pickSamples(rows: readonly SongRow[], poolLangs: ReadonlySet<string> = new Set()): LanguageSample[] {
  return HERO_LANGS.map(({ code }) => {
    let song: LanguageSample["song"] = null;
    for (const r of rows) {
      const doc = r.song_documents;
      if (!doc || doc.language !== code) continue;
      const lines = previewLines(doc.document_json?.sections);
      if (lines.length === 0) continue;
      song = { publicId: r.public_id, title: doc.title?.trim() || "Untitled", lines };
      break;
    }
    return { code, song, pool: poolLangs.has(code), idea: EXAMPLE_IDEAS[code][0] };
  });
}

const loadRows = unstable_cache(
  async (): Promise<SongRow[]> => {
    const { data } = await createServiceRoleClient()
      .from("jobs")
      .select("public_id, song_documents!inner ( title, language, document_json ), tracks!inner ( id )")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .in("song_documents.language", HERO_LANGS.map((l) => l.code))
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(40)
      .returns<SongRow[]>();
    return data ?? [];
  },
  ["landing-language-samples"],
  { revalidate: 300 },
);

/** Never throws: a database problem just yields idea-only cards. */
export async function loadLanguageSamples(): Promise<LanguageSample[]> {
  const [rows, pool] = await Promise.all([loadRows().catch(() => [] as SongRow[]), loadPool().catch(() => [])]);
  return pickSamples(rows, new Set(pool.map((t) => t.language)));
}
