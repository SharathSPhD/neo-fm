/**
 * /api/admin/review-kit -- operator side of the native-speaker review kit (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 *   POST ?action=seed&lang=kn      pick up to 5 published, completed songs in that language (or pass ?job_ids=a,b,c)
 *   POST ?action=token&lang=kn[&alias=Kannada reviewer A]   mint a reviewer link; the token is shown once
 *   GET  ?action=report            per-language rating summary
 * Only songs the owner already published (public/unlisted) are eligible, so reviewers never see private songs.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import {
  hashToken, isReviewLanguage, newToken, SONGS_PER_LANGUAGE, summarize, type RatingRow,
} from "../../../../lib/native-review/kit";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const action = p.get("action");
  const lang = p.get("lang") ?? "";
  if (!isReviewLanguage(lang)) return NextResponse.json({ error: "bad_lang" }, { status: 400 });
  const db = serviceClient();

  if (action === "token") {
    const alias = (p.get("alias") ?? "").trim().slice(0, 60) || null;
    const token = newToken();
    const { error } = await db.from("review_tokens").insert({ token_hash: hashToken(token), language: lang, alias });
    if (error) return NextResponse.json({ error: "insert_failed", detail: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, language: lang, alias, path: `/native-review/${token}`, note: "token is not stored; copy the link now" });
  }

  if (action === "seed") {
    const { data: existing } = await db.from("review_items").select("job_id, position").eq("language", lang);
    const have = (existing ?? []) as { job_id: string; position: number }[];
    const room = SONGS_PER_LANGUAGE - have.length;
    if (room <= 0) return NextResponse.json({ ok: true, added: 0, note: "already full" });
    const explicit = (p.get("job_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (explicit.some((id) => !UUID.test(id))) return NextResponse.json({ error: "bad_job_ids" }, { status: 400 });
    let q = db
      .from("jobs")
      .select("id, song_documents!inner(language), tracks!inner(id)")
      .eq("status", "completed")
      .in("published_visibility", ["public", "unlisted"])
      .eq("song_documents.language", lang)
      .order("created_at", { ascending: false })
      .limit(50);
    if (explicit.length) q = q.in("id", explicit);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
    const taken = new Set(have.map((h) => h.job_id));
    const picks = ((data ?? []) as unknown as { id: string }[]).filter((j) => !taken.has(j.id)).slice(0, room);
    const base = have.length;
    const { error: insErr } = picks.length
      ? await db.from("review_items").insert(picks.map((j, i) => ({ language: lang, job_id: j.id, position: base + i })))
      : { error: null };
    if (insErr) return NextResponse.json({ error: "insert_failed", detail: insErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: picks.length, total: base + picks.length, short_by: Math.max(0, room - picks.length) });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const { data, error } = await db
    .from("review_ratings")
    .select("token_id, lyric_quality, pronunciation, prosody, cultural_fit, sounds_native, review_items!inner(language)");
  if (error) return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  const rows: RatingRow[] = ((data ?? []) as unknown as (Omit<RatingRow, "language"> & { review_items: { language: string } })[]).map(
    ({ review_items, ...r }) => ({ ...r, language: review_items.language }),
  );
  return NextResponse.json({ summary: summarize(rows) });
}
