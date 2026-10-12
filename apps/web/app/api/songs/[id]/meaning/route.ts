/**
 * GET /api/songs/[id]/meaning
 *
 * Original script, romanization and an English machine translation for each lyric line of the caller's song.
 * Generated once (Haiku) and cached in `song_lyric_meanings`; later calls only read the cache.
 * Access is decided by the caller's own RLS read of the job; the cache itself is service-role only.
 */
import { NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "@/lib/agent/adapters";
import { generateMeaning, MEANING_DISCLAIMER, MEANING_MODEL, type MeaningLine } from "@/lib/lyrics/meaning";
import type { SyncSectionInput } from "@/lib/lyrics/sync";
import { requireUser } from "@/lib/supabase/auth";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  const { data: job } = await authed.supabase
    .from("jobs")
    .select("id, user_id, song_documents ( language, document_json )")
    .eq("id", params.id)
    .maybeSingle<{ id: string; user_id: string; song_documents: { language: string; document_json: { sections?: SyncSectionInput[] } } | null }>();
  if (!job || job.user_id !== authed.user.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sections = job.song_documents?.document_json?.sections ?? [];

  const db = serviceClient();
  const { data: cached } = await db.from("song_lyric_meanings").select("lines, model").eq("job_id", job.id).maybeSingle<{ lines: MeaningLine[]; model: string }>();
  if (cached) return NextResponse.json({ lines: cached.lines, machine_translation: true, disclaimer: MEANING_DISCLAIMER, cached: true });

  let lines: MeaningLine[];
  try {
    lines = await generateMeaning(anthropicClient(), { language: job.song_documents?.language ?? "Indian language", sections });
  } catch {
    return NextResponse.json({ error: "meaning_unavailable" }, { status: 502 });
  }
  if (lines.length > 0) {
    // A concurrent request may have won; ignoreDuplicates keeps the first row so every viewer sees one translation.
    await db.from("song_lyric_meanings").upsert({ job_id: job.id, lines, model: MEANING_MODEL }, { onConflict: "job_id", ignoreDuplicates: true });
  }
  return NextResponse.json({ lines, machine_translation: true, disclaimer: MEANING_DISCLAIMER, cached: false });
}
