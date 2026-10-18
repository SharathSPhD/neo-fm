import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "../supabase/server";
import { songVisibleToPublic } from "./schema";

export interface CollectionRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  visibility: "private" | "unlisted" | "public";
  public_id: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionSong {
  jobId: string;
  publicId: string | null;
  title: string;
  language: string | null;
  style: string | null;
  owned: boolean;
  position: number;
}

interface ItemRow {
  position: number;
  jobs: {
    id: string;
    user_id: string;
    status: string;
    public_id: string | null;
    published_visibility: string | null;
    song_documents: { title: string | null; language: string | null; style_family: string | null } | null;
    tracks: { id: string }[] | null;
  } | null;
}

/** Untyped service client: the collections tables aren't in the generated Database type yet. */
export function collectionsDb(): SupabaseClient {
  return createServiceRoleClient() as unknown as SupabaseClient;
}

export const COLLECTION_COLUMNS =
  "id, user_id, title, description, visibility, public_id, created_at, updated_at";

/**
 * Songs of a collection in order. For the owner every completed song is
 * listed; for anyone else (viewerId null) only songs that are themselves
 * published, so a private song its owner added never leaks through a
 * shared playlist.
 */
export async function loadCollectionSongs(
  sb: SupabaseClient,
  collectionId: string,
  viewerId: string | null,
): Promise<CollectionSong[]> {
  const { data } = await sb
    .from("collection_items")
    .select(
      "position, jobs!inner ( id, user_id, status, public_id, published_visibility, song_documents ( title, language, style_family ), tracks ( id ) )",
    )
    .eq("collection_id", collectionId)
    .order("position", { ascending: true })
    .returns<ItemRow[]>();
  return (data ?? []).flatMap((r) => {
    const j = r.jobs;
    if (!j || j.status !== "completed" || !(j.tracks && j.tracks.length > 0)) return [];
    const owned = viewerId !== null && j.user_id === viewerId;
    const published = songVisibleToPublic(j.published_visibility);
    if (!owned && !published) return [];
    return [
      {
        jobId: j.id,
        publicId: published ? j.public_id : null,
        title: j.song_documents?.title?.trim() || "Untitled",
        language: j.song_documents?.language ?? null,
        style: j.song_documents?.style_family ?? null,
        owned,
        position: r.position,
      },
    ];
  });
}

export async function loadOwnedCollection(userId: string, id: string) {
  const sb = collectionsDb();
  const { data } = await sb
    .from("collections")
    .select(COLLECTION_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<CollectionRow>();
  if (!data) return null;
  return { collection: data, songs: await loadCollectionSongs(sb, data.id, userId) };
}

/** Public/unlisted collection by slug, as a stranger sees it; null for private or unknown (callers 404). */
export async function loadPublicCollection(publicId: string) {
  const sb = collectionsDb();
  const { data } = await sb
    .from("collections")
    .select(COLLECTION_COLUMNS)
    .eq("public_id", publicId)
    .in("visibility", ["public", "unlisted"])
    .maybeSingle<CollectionRow>();
  if (!data) return null;
  return { collection: data, songs: await loadCollectionSongs(sb, data.id, null) };
}
