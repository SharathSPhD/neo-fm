/**
 * POST /api/songs/[id]/variation
 *
 * Creates a new generation job seeded with the source song's
 * SongDocument. The music engine is stochastic, so re-running the same
 * document produces a different render -- the user gets a fresh
 * variation without having to re-author lyrics.
 *
 * The new job goes through `create_song_job` (RPC) so quota,
 * storage caps, and the co-composer hot path all still apply.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import type { Json } from "@/lib/supabase/database.types";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  // Fetch the parent's song_document. RLS scopes this to the owner.
  const { data: parent, error: parentErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      song_documents (
        document_json, language, style_family
      )
    `,
    )
    .eq("id", params.id)
    .maybeSingle<{
      id: string;
      song_documents: {
        document_json: Record<string, unknown>;
        language: string;
        style_family: string;
      } | null;
    }>();
  if (parentErr) {
    return NextResponse.json(
      { error: "lookup_failed", details: parentErr.message },
      { status: 500 },
    );
  }
  if (!parent?.song_documents) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const doc = parent.song_documents.document_json;
  const target_duration_seconds =
    (typeof doc.target_duration_seconds === "number"
      ? doc.target_duration_seconds
      : null) ?? 60;

  const trace_id = randomUUID();
  const attempt_id = randomUUID();

  const { data, error } = await supabase.rpc("create_song_job", {
    p_song_document: doc as unknown as Json,
    p_language:
      parent.song_documents.language as never,
    p_style_family:
      parent.song_documents.style_family as never,
    p_target_duration_seconds: target_duration_seconds,
    p_priority: 0,
    p_attempt_id: attempt_id,
    p_trace_id: trace_id,
  } as never);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("quota_exceeded")) {
      return NextResponse.json({ error: "quota_exceeded" }, { status: 429 });
    }
    if (msg.includes("concurrent_cap_exceeded")) {
      return NextResponse.json(
        { error: "concurrent_cap_exceeded" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "variation_failed", details: msg },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    return NextResponse.json({ error: "variation_failed" }, { status: 500 });
  }
  return NextResponse.json(
    { job_id: row.job_id, status: row.status, song_id: row.song_id },
    { status: 202 },
  );
}
