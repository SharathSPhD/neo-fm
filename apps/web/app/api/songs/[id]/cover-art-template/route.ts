/**
 * POST /api/songs/[id]/cover-art-template
 *
 * v1.4 Sprint 1: template-tier cover-art generation. Bypasses the pgmq
 * queue + DGX worker. Renders a deterministic SVG inline, uploads it to
 * the `cover-art` Supabase Storage bucket via service-role, and records
 * the attempt + artefact via the SECURITY DEFINER
 * `record_cover_art_template` RPC (migration 0036) in one round-trip.
 *
 * Why a separate route from `cover-art/route.ts`:
 *   - the existing route enqueues into pgmq; template tier does not.
 *   - the existing route hits the diffusion premium tier; this route
 *     hits the always-on template tier.
 *
 * Returns 200 + `{ attempt_id, cover_art_id, url }` synchronously
 * (target latency p95 < 300 ms).
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { renderTemplate, templateStoragePath } from "@/lib/cover-art-template";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const dynamic = "force-dynamic";

interface SongRow {
  id: string;
  user_id: string;
  song_documents: {
    title: string | null;
    language: string | null;
    style_family: string | null;
  } | null;
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;

  const { data: song, error: songErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      user_id,
      song_documents (
        title, language, style_family
      )
    `,
    )
    .eq("id", params.id)
    .maybeSingle<SongRow>();
  if (songErr || !song?.song_documents) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const title = song.song_documents.title?.trim() ?? "Untitled song";
  const styleFamily = song.song_documents.style_family ?? null;
  const attemptId = randomUUID();
  const traceId = randomUUID();
  const { svg, bytes, contentType } = renderTemplate({
    jobId: params.id,
    title,
    styleFamily,
  });
  const storagePath = templateStoragePath(user.id, params.id, attemptId);

  // Upload bytes via service role — RLS on storage.objects only grants
  // anon/authenticated SELECT on this bucket, never INSERT.
  const service = createServiceRoleClient();
  const { error: uploadErr } = await service.storage
    .from("cover-art")
    .upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: "upload_failed", details: uploadErr.message },
      { status: 500 },
    );
  }

  // Record attempt + cover row atomically. Ownership is re-asserted
  // inside the RPC (defence in depth).
  const prompt = `template:${styleFamily ?? "default"}:${title}`;
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "record_cover_art_template",
    {
      p_song_id: params.id,
      p_attempt_id: attemptId,
      p_prompt: prompt,
      p_storage_path: storagePath,
      p_trace_id: traceId,
    } as never,
  );
  if (rpcErr) {
    return NextResponse.json(
      {
        error: "record_failed",
        details: rpcErr.message ?? "rpc rejected the request",
      },
      { status: 500 },
    );
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : null;

  // Mint a 1h signed URL so the panel can swap in the new image
  // immediately. We use the user-context client so the existing RLS
  // policy continues to apply.
  const { data: signed } = await supabase.storage
    .from("cover-art")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json(
    {
      attempt_id: row?.attempt_id ?? attemptId,
      cover_art_id: row?.cover_art_id ?? null,
      url: signed?.signedUrl ?? null,
      backend: "template",
      // SVG body included so a Playwright spec or downstream caller can
      // verify the bytes without a Storage round-trip.
      svg_size: svg.length,
    },
    { status: 200 },
  );
}
