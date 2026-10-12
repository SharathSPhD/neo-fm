import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "@/lib/supabase/server";

import { buildRecap, extractMoods, type MonthRange, type Recap, type RecapSong } from "./compute";

/** Songs per recap we look at; a month with more than this is far outside normal use. */
const MAX_SONGS = 500;
const CHUNK = 100;

type Db = SupabaseClient;

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));

interface JobRow {
  id: string;
  created_at: string;
  song_documents: { title: string | null; language: string; style_family: string; document_json: unknown } | null;
}

/**
 * Recap for one user and month. `userDb` is the request's session client (RLS: the user's own songs and
 * collections). Reactions other people made on those songs are read with the service client but only as
 * counts, restricted to this user's song ids; nothing identifying anyone else leaves this function.
 */
export async function loadRecap(userDb: Db, userId: string, range: MonthRange): Promise<Recap> {
  const { data: jobs, error } = await userDb
    .from("jobs")
    .select("id, created_at, song_documents(title, language, style_family, document_json)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end)
    .order("created_at", { ascending: true })
    .limit(MAX_SONGS);
  if (error) throw new Error(`recap_jobs_failed: ${error.message}`);

  const songs: RecapSong[] = ((jobs ?? []) as unknown as JobRow[])
    .filter((j) => j.song_documents)
    .map((j) => {
      const d = j.song_documents!;
      return {
        id: j.id,
        title: (d.title ?? "").trim() || "Untitled",
        language: d.language,
        style_family: d.style_family,
        created_at: j.created_at,
        moods: extractMoods(d.document_json),
      };
    });

  const ids = songs.map((s) => s.id);
  const likes: Record<string, number> = {};
  const listeners: Record<string, number> = {};
  if (ids.length > 0) {
    const admin = createServiceRoleClient() as unknown as Db;
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const [l, f] = await Promise.all([
        admin.from("song_likes").select("job_id, user_id").in("job_id", chunk).neq("user_id", userId).gte("created_at", range.start).lt("created_at", range.end),
        admin
          .from("feedback_events")
          .select("job_id, user_id")
          .in("job_id", chunk)
          .neq("user_id", userId)
          .eq("kind", "play_pct")
          .gte("value", 0.7)
          .gte("created_at", range.start)
          .lt("created_at", range.end)
          .limit(5000),
      ]);
      if (l.error) throw new Error(`recap_likes_failed: ${l.error.message}`);
      if (f.error) throw new Error(`recap_listens_failed: ${f.error.message}`);
      for (const r of (l.data ?? []) as { job_id: string }[]) likes[r.job_id] = (likes[r.job_id] ?? 0) + 1;
      for (const r of (f.data ?? []) as { job_id: string; user_id: string }[]) {
        const k = `${r.job_id}:${r.user_id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        listeners[r.job_id] = (listeners[r.job_id] ?? 0) + 1;
      }
    }
  }

  // Collections arrive with their own migration; before it exists the recap just omits them.
  let collectionsCreated = 0;
  let songsCollected = 0;
  const made = await userDb
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (!made.error) collectionsCreated = made.count ?? 0;
  else if (!isMissingTable(made.error)) throw new Error(`recap_collections_failed: ${made.error.message}`);
  if (!made.error) {
    const added = await userDb
      .from("collection_items")
      .select("job_id, collections!inner(user_id)", { count: "exact", head: true })
      .eq("collections.user_id", userId)
      .gte("added_at", range.start)
      .lt("added_at", range.end);
    if (!added.error) songsCollected = added.count ?? 0;
  }

  return buildRecap({ songs, likes, listeners, collectionsCreated, songsCollected });
}
