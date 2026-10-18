/** I/O adapters for the host-side cascade: Anthropic completions, the cascade service, and the agent_runs / song_documents rows. */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { safeEmbedUrl } from "../agent/embed-url";
import { mergeLyrics } from "../agent/lyrics-merge";
import type { CascadeReply, CascadeRequest, HostCascadeDeps, HostSong } from "./host-cascade";

const CASCADE_TIMEOUT_MS = 30_000;

export function hostCascadeDeps(client: Anthropic, log?: (m: string) => void, env = process.env): HostCascadeDeps {
  // Same SSRF rules as EMBED_URL: https, public host only.
  const base = safeEmbedUrl(env.PCE_CASCADE_URL);
  const token = env.PCE_CASCADE_TOKEN?.trim();
  return {
    log,
    async complete({ model, system, prompt, maxTokens }) {
      const res = await client.messages.create({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] });
      return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    },
    async cascade(body: CascadeRequest): Promise<CascadeReply> {
      if (!base || !token) throw new Error("PCE cascade service is not configured");
      const res = await fetch(`${base}/cascade`, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(CASCADE_TIMEOUT_MS),
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw Object.assign(new Error(`cascade service ${res.status}: ${(await res.text()).slice(0, 160)}`), { status: res.status });
      return (await res.json()) as CascadeReply;
    },
  };
}

type RunOutputs = { lyrics: string | null; polished_lyrics: string | null; agent_song_document: { title?: string; style_prompt?: string; cascade?: Record<string, unknown> } | null };

export async function loadHostSong(db: SupabaseClient, jobId: string): Promise<HostSong | null> {
  const { data } = await db.from("agent_runs").select("lyrics,agent_song_document").eq("job_id", jobId).limit(1);
  const r = ((data ?? [])[0] ?? null) as Pick<RunOutputs, "lyrics" | "agent_song_document"> | null;
  const d = r?.agent_song_document;
  if (!r?.lyrics || !d?.style_prompt) return null;
  return { lyrics: r.lyrics, title: d.title ?? "", stylePrompt: d.style_prompt, cascade: d.cascade ?? {} };
}

async function writeSongDocument(db: SupabaseClient, docId: string, title: string | null, lyrics: string) {
  const { data } = await db.from("song_documents").select("document_json").eq("id", docId).limit(1);
  const sd = ((data ?? [])[0] ?? null) as { document_json: { sections?: unknown[] } } | null;
  const patch: Record<string, unknown> = {};
  if (title?.trim()) patch.title = title.trim().slice(0, 120);
  if (sd && lyrics) patch.document_json = mergeLyrics(sd.document_json as { sections?: never[] }, lyrics);
  if (Object.keys(patch).length) await db.from("song_documents").update(patch).eq("id", docId);
}

/** Persist the committed song before the paid render, so the lyrics show while Lyria works and survive a retry. */
export async function saveHostSong(db: SupabaseClient, jobId: string, docId: string, song: HostSong): Promise<void> {
  const { error } = await db.from("agent_runs").update({ lyrics: song.lyrics, agent_song_document: { title: song.title, style_prompt: song.stylePrompt, cascade: song.cascade, source: "host-cascade" } }).eq("job_id", jobId);
  if (error) throw new Error(`agent_runs save failed: ${error.message}`);
  await writeSongDocument(db, docId, song.title, song.lyrics);
}

/** What was sung is the polished text; make the stored lyrics (and the QA that scores them) match, as persistOutputs does for agent runs. */
export async function adoptPolishedLyrics(db: SupabaseClient, jobId: string, docId: string): Promise<void> {
  try {
    const { data } = await db.from("agent_runs").select("polished_lyrics").eq("job_id", jobId).limit(1);
    const polished = ((data ?? [])[0] as { polished_lyrics: string | null } | undefined)?.polished_lyrics;
    if (!polished) return;
    await db.from("agent_runs").update({ lyrics: polished }).eq("job_id", jobId);
    await writeSongDocument(db, docId, null, polished);
  } catch { /* the song is already rendered; stored lyrics staying the pre-polish text is the lesser problem */ }
}
