/**
 * POST /api/songs/[id]/variation
 *
 * Creates a new generation job seeded with the source song's
 * SongDocument. The music engine is stochastic, so re-running the same
 * document produces a different render -- the user gets a fresh
 * variation without having to re-author lyrics.
 *
 * v1.4 Sprint 3 widens the contract: the body is now an optional
 * `ForkSongBody` (see `lib/song/fork.ts`) with distance / tempo / key /
 * raga / voice / section_ids / title overrides. Variations default to a
 * low `distance` (25) so unspecified runs still feel "more same".
 *
 * Empty body is still accepted (back-compat with the v1.3 callers + the
 * production smoke tests). The new job goes through `create_song_job`
 * (RPC) so quota, storage caps, and the co-composer hot path still apply.
 */
import { SongDocumentSchema } from "@neo-fm/song-doc";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyForkToDoc,
  type ParentDocLike,
} from "@/lib/song/fork-applier";
import { DEFAULT_VARIATION_DISTANCE, ForkSongBodySchema } from "@/lib/song/fork";
import { requireUser } from "@/lib/supabase/auth";
import type { Json } from "@/lib/supabase/database.types";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dynamic = "force-dynamic";

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError("variation body must be valid JSON");
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: z.infer<typeof ForkSongBodySchema>;
  try {
    const raw = await readBody(req);
    body = ForkSongBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "invalid_json" },
        { status: 400 },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_body", details: err.flatten() },
        { status: 422 },
      );
    }
    throw err;
  }

  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { data: parent, error: parentErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      song_documents (
        document_json, language, style_family, title
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
        title: string | null;
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
  const parentDoc = parent.song_documents.document_json as ParentDocLike;
  const styledParent: ParentDocLike = {
    ...parentDoc,
    style_family: parent.song_documents.style_family,
    title: (parentDoc.title ?? parent.song_documents.title) ?? undefined,
  };

  const applied = applyForkToDoc(styledParent, body, {
    kind: "variation",
    appendRemixSuffix: false,
    defaultDistance: DEFAULT_VARIATION_DISTANCE,
  });
  if (!applied.ok) {
    return NextResponse.json(
      { error: applied.error, message: applied.message },
      { status: 422 },
    );
  }

  // Round-trip the mutated doc through SongDocumentSchema so the worker
  // never sees a malformed fork (e.g. a raga override that yields an
  // invalid combination after coercion).
  const docCheck = SongDocumentSchema.safeParse(applied.doc);
  if (!docCheck.success) {
    return NextResponse.json(
      {
        error: "variation_doc_invalid",
        details: docCheck.error.flatten(),
      },
      { status: 500 },
    );
  }
  const validatedDoc = docCheck.data;

  const target_duration_seconds = validatedDoc.target_duration_seconds;
  const trace_id = randomUUID();
  const attempt_id = randomUUID();

  const { data, error } = await supabase.rpc("create_song_job", {
    p_song_document: validatedDoc as unknown as Json,
    p_language: parent.song_documents.language as never,
    p_style_family: parent.song_documents.style_family as never,
    p_target_duration_seconds: target_duration_seconds,
    p_priority: 0,
    p_attempt_id: attempt_id,
    p_trace_id: trace_id,
  } as never);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("storage_quota_exceeded")) {
      return NextResponse.json(
        { error: "quota_exceeded", reason: "storage_bytes" },
        { status: 429 },
      );
    }
    if (msg.includes("concurrent_cap_exceeded")) {
      return NextResponse.json(
        { error: "concurrent_cap_exceeded" },
        { status: 429 },
      );
    }
    if (msg.includes("quota_exceeded")) {
      return NextResponse.json({ error: "quota_exceeded" }, { status: 429 });
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
    {
      job_id: row.job_id,
      status: row.status,
      song_id: row.song_id,
      distance: body.distance ?? DEFAULT_VARIATION_DISTANCE,
    },
    { status: 202 },
  );
}
