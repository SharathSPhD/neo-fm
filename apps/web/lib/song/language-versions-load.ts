import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { VersionSibling } from "./language-version";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  status: string;
  user_id: string;
  public_id: string | null;
  published_visibility: string | null;
  version_group: string | null;
  song_documents: { language: string; title: string | null } | null;
}

/**
 * Sibling language versions of a song (including itself), oldest first.
 * Uses the caller's own client, so RLS decides what is visible: owners see
 * their own versions, everyone else only published ones. Tolerant: before
 * migration (version_group column) or on any error this returns just [].
 * `publishedOnly` additionally drops unpublished rows (public page).
 */
export async function loadVersionSiblings(
  sb: SupabaseClient,
  jobId: string,
  opts: { publishedOnly?: boolean; viewerId?: string | null } = {},
): Promise<VersionSibling[]> {
  try {
    const { data: me, error } = await sb
      .from("jobs")
      .select("id, version_group")
      .eq("id", jobId)
      .maybeSingle<{ id: string; version_group: string | null }>();
    if (error || !me) return [];
    const group = me.version_group ?? me.id;
    if (!UUID_RE.test(group)) return [];
    const { data: rows, error: e2 } = await sb
      .from("jobs")
      .select(
        "id, user_id, status, public_id, published_visibility, version_group, created_at, song_documents ( language, title )",
      )
      .or(`id.eq.${group},version_group.eq.${group}`)
      .order("created_at", { ascending: true })
      .limit(12)
      .returns<(Row & { created_at: string })[]>();
    if (e2 || !rows) return [];
    return rows
      .filter((r) => r.song_documents)
      .filter((r) => {
        if (r.id === jobId) return true;
        const published = r.published_visibility === "public" || r.published_visibility === "unlisted";
        return opts.publishedOnly ? published && r.status === "completed" : true;
      })
      .map((r) => ({
        id: r.id,
        language: r.song_documents!.language,
        title: r.song_documents!.title,
        status: r.status,
        publicId: r.published_visibility === "private" ? null : r.public_id,
        owned: !!opts.viewerId && r.user_id === opts.viewerId,
      }));
  } catch {
    return [];
  }
}
