import "server-only";

import { serviceClient } from "../agent/adapters";
import { hashToken, isWellFormedToken, type ReviewLanguage } from "./kit";

export interface ReviewerToken {
  id: string;
  language: ReviewLanguage;
  alias: string | null;
}

/** Resolves a link token to its reviewer, or null when malformed, unknown or revoked. */
export async function resolveToken(token: string): Promise<ReviewerToken | null> {
  if (!isWellFormedToken(token)) return null;
  const db = serviceClient();
  const { data } = await db
    .from("review_tokens")
    .select("id, language, alias")
    .eq("token_hash", hashToken(token))
    .eq("revoked", false)
    .maybeSingle<ReviewerToken>();
  if (!data) return null;
  await db.from("review_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

export interface ReviewSong {
  itemId: string;
  title: string;
  audioUrl: string | null;
  sections: { type: string; lyrics: string }[];
  mine: {
    lyric_quality: number; pronunciation: number; prosody: number; cultural_fit: number;
    sounds_native: boolean; comment: string | null;
  } | null;
}

interface ItemRow {
  id: string;
  jobs: {
    song_documents: { title: string | null; document_json: { sections?: { type: string; lyrics?: string }[] } } | null;
    tracks: { url: string; created_at: string }[] | null;
  } | null;
}

export async function loadSongs(reviewer: ReviewerToken): Promise<ReviewSong[]> {
  const db = serviceClient();
  const { data } = await db
    .from("review_items")
    .select("id, jobs!inner(song_documents(title, document_json), tracks(url, created_at))")
    .eq("language", reviewer.language)
    .order("position", { ascending: true });
  const items = (data ?? []) as unknown as ItemRow[];
  const { data: mine } = await db
    .from("review_ratings")
    .select("item_id, lyric_quality, pronunciation, prosody, cultural_fit, sounds_native, comment")
    .eq("token_id", reviewer.id);
  const byItem = new Map((mine ?? []).map((m: { item_id: string }) => [m.item_id, m]));
  return Promise.all(
    items.map(async (it, i) => {
      const track = (it.jobs?.tracks ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      let audioUrl: string | null = null;
      if (track) {
        const { data: signed } = await db.storage.from("tracks").createSignedUrl(track.url.replace(/^tracks\//, ""), 60 * 60);
        audioUrl = signed?.signedUrl ?? null;
      }
      const doc = it.jobs?.song_documents;
      const rated = byItem.get(it.id) as ReviewSong["mine"] | undefined;
      return {
        itemId: it.id,
        title: `Song ${i + 1}`,
        audioUrl,
        sections: (doc?.document_json.sections ?? []).filter((s) => s.lyrics).map((s) => ({ type: s.type, lyrics: s.lyrics as string })),
        mine: rated ?? null,
      };
    }),
  );
}
