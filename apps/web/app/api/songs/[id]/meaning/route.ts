/**
 * GET /api/songs/[id]/meaning
 *
 * Original script, romanization and an English machine translation for each lyric line of the caller's song.
 * Generated once (Haiku) and cached in `song_lyric_meanings`; later calls only read the cache.
 * Access is decided by the caller's own RLS read of the job; the cache itself is service-role only.
 * Cost guards: failures are negative-cached for 10 minutes, each user may generate at most MEANING_DAILY_CAP songs per
 * rolling day, and every generation is reserved against a shared budget (public.reserve_spend, provider `claude_meaning`).
 */
import { NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "@/lib/agent/adapters";
import {
  FAILURE_CACHE_MS,
  flattenLyricLines,
  generateMeaning,
  MEANING_COST_GBP,
  MEANING_DAILY_CAP,
  MEANING_DISCLAIMER,
  MEANING_MODEL,
  type MeaningLine,
} from "@/lib/lyrics/meaning";
import type { SyncSectionInput } from "@/lib/lyrics/sync";
import { requireUser } from "@/lib/supabase/auth";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const budgetCapGbp = () => Number(process.env.MEANING_BUDGET_GBP ?? 5);

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  const { data: job } = await authed.supabase
    .from("jobs")
    .select("id, user_id, song_documents ( language, document_json )")
    .eq("id", id)
    .maybeSingle<{ id: string; user_id: string; song_documents: { language: string; document_json: { sections?: SyncSectionInput[] } } | null }>();
  if (!job || job.user_id !== authed.user.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sections = job.song_documents?.document_json?.sections ?? [];

  const db = serviceClient();
  const { data: cached } = await db
    .from("song_lyric_meanings")
    .select("status, lines, created_at")
    .eq("job_id", job.id)
    .maybeSingle<{ status: "ok" | "failed"; lines: MeaningLine[] | null; created_at: string }>();
  if (cached?.status === "ok" && cached.lines) {
    return NextResponse.json({ lines: cached.lines, machine_translation: true, disclaimer: MEANING_DISCLAIMER, cached: true });
  }
  if (cached?.status === "failed") {
    const retryInMs = FAILURE_CACHE_MS - (Date.now() - new Date(cached.created_at).getTime());
    if (retryInMs > 0) {
      return NextResponse.json({ error: "meaning_unavailable", retry_after_seconds: Math.ceil(retryInMs / 1000) }, { status: 503, headers: { "retry-after": String(Math.ceil(retryInMs / 1000)) } });
    }
  }

  // Daily cap counts distinct songs attempted (ok or failed) in the last 24h; the row being retried does not count twice.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("song_lyric_meanings").select("job_id", { count: "exact", head: true }).eq("user_id", authed.user.id).gte("created_at", since).neq("job_id", job.id);
  if ((count ?? 0) >= MEANING_DAILY_CAP) {
    return NextResponse.json({ error: "daily_limit", limit: MEANING_DAILY_CAP }, { status: 429 });
  }

  const language = job.song_documents?.language ?? "Indian language";
  if (flattenLyricLines(sections).length === 0) {
    return NextResponse.json({ lines: [], machine_translation: true, disclaimer: MEANING_DISCLAIMER, cached: false });
  }
  const { data: reserved } = await db.rpc("reserve_spend", { p_provider: "claude_meaning", p_amount: MEANING_COST_GBP, p_cap: budgetCapGbp() });
  if (reserved !== true) return NextResponse.json({ error: "meaning_unavailable" }, { status: 503 });

  let lines: MeaningLine[];
  try {
    lines = await generateMeaning(anthropicClient(), { language, sections });
  } catch {
    await db.from("song_lyric_meanings").upsert({ job_id: job.id, user_id: authed.user.id, status: "failed", lines: null, model: MEANING_MODEL, created_at: new Date().toISOString() }, { onConflict: "job_id" });
    return NextResponse.json({ error: "meaning_unavailable", retry_after_seconds: FAILURE_CACHE_MS / 1000 }, { status: 502 });
  }
  // First writer wins so every viewer sees one translation: a retried failed row is flipped to ok, otherwise insert-if-absent.
  const ok = { job_id: job.id, user_id: authed.user.id, status: "ok", lines, model: MEANING_MODEL, created_at: new Date().toISOString() };
  await db.from("song_lyric_meanings").update(ok).eq("job_id", job.id).eq("status", "failed");
  await db.from("song_lyric_meanings").upsert(ok, { onConflict: "job_id", ignoreDuplicates: true });
  return NextResponse.json({ lines, machine_translation: true, disclaimer: MEANING_DISCLAIMER, cached: false });
}
