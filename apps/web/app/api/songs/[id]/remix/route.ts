/**
 * POST /api/songs/[id]/remix
 *
 * Forks an existing song into a new generation job. The new job:
 *
 *   - Reuses the same lyrics, sections, style_family, language, and target
 *     duration as the parent.
 *   - Applies the v1.4 Sprint 3 `ForkSongBody` overrides
 *     (distance / tempo_bpm / key_override / raga_override / voice_id /
 *     section_ids / title). Empty body is accepted and falls back to
 *     the v1.3 behaviour: a ±15 BPM tempo jitter and a " (remix)" title
 *     suffix.
 *   - Records the parent job id in `jobs.remixed_from` for lineage.
 *
 * The parent doesn't need to belong to the caller as long as it is
 * `published_visibility in ('public','unlisted')`. RLS on `jobs`
 * already enforces this:
 *
 *   - Own jobs   → readable.
 *   - Public/unlisted public_id != null jobs → readable to anon.
 *
 * Both paths run through `public.create_song_job` so quota, advisory
 * locks, and storage caps are checked exactly the same way as a fresh
 * `/api/songs` POST. That keeps remixes accountable to the user's monthly
 * quota; we don't want a remix-spam vector around the limits.
 */
import { SongDocumentSchema } from "@neo-fm/song-doc";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyForkToDoc,
  type ParentDocLike,
} from "@/lib/song/fork-applier";
import { DEFAULT_REMIX_DISTANCE, ForkSongBodySchema } from "@/lib/song/fork";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type ParentJobRow = {
  id: string;
  song_document_id: string;
  song_documents: {
    id: string;
    title: string | null;
    language: string;
    style_family: string;
    document_json: ParentDocLike;
  } | null;
};

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError("remix body must be valid JSON");
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
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
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

  // RLS handles the visibility check: the SELECT will return nothing if
  // the caller cannot see this job under (`own` ∨ `public ∨ unlisted`).
  const { data: parentRow, error: parentErr } = await supabase
    .from("jobs")
    .select(
      `
      id, song_document_id,
      song_documents ( id, title, language, style_family, document_json )
    `,
    )
    .eq("id", params.id)
    .maybeSingle<ParentJobRow>();

  if (parentErr) {
    return NextResponse.json(
      { error: "lookup_failed", details: parentErr.message },
      { status: 500 },
    );
  }
  if (!parentRow || !parentRow.song_documents) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parentDoc = parentRow.song_documents;
  const baseTitle = (parentDoc.document_json.title ?? parentDoc.title ?? "Untitled").trim();
  const baseDoc: ParentDocLike = {
    ...parentDoc.document_json,
    style_family: parentDoc.style_family,
    title: baseTitle,
  };

  const applied = applyForkToDoc(baseDoc, body, {
    kind: "remix",
    appendRemixSuffix: true,
    defaultDistance: DEFAULT_REMIX_DISTANCE,
  });
  if (!applied.ok) {
    return NextResponse.json(
      { error: applied.error, message: applied.message },
      { status: 422 },
    );
  }

  // Validate the mutated doc through the shared zod schema so an upstream
  // worker never sees a corrupted document. Reject cleanly otherwise.
  const docCheck = SongDocumentSchema.safeParse(applied.doc);
  if (!docCheck.success) {
    return NextResponse.json(
      {
        error: "remix_doc_invalid",
        details: docCheck.error.flatten(),
      },
      { status: 500 },
    );
  }
  const validatedDoc = docCheck.data;

  const trace_id = randomUUID();
  const attempt_id = randomUUID();

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "create_song_job",
    {
      p_song_document: validatedDoc as unknown as Json,
      p_language: parentDoc.language as never,
      p_style_family: parentDoc.style_family as never,
      p_target_duration_seconds: validatedDoc.target_duration_seconds,
      p_priority: 0,
      p_attempt_id: attempt_id,
      p_trace_id: trace_id,
    } as never,
  );

  if (rpcErr) {
    const msg = rpcErr.message ?? "";
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
      return NextResponse.json(
        { error: "quota_exceeded", reason: "rows_per_month" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "remix_failed", details: msg },
      { status: 500 },
    );
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : null;
  if (!row?.job_id) {
    return NextResponse.json({ error: "remix_failed" }, { status: 500 });
  }

  // Stamp the lineage. There is no jobs_update_own RLS policy (only
  // SELECT and DELETE policies exist today), so a plain owner-scoped
  // UPDATE would silently affect 0 rows. We use the service-role
  // client and constrain the update to the row we just created for
  // the caller (id+user_id match) so this can't be abused to backfill
  // lineage onto someone else's job.
  const svc = createServiceRoleClient();
  const { error: lineageErr, data: lineageRows } = await svc
    .from("jobs")
    .update({ remixed_from: parentRow.id })
    .eq("id", row.job_id)
    .eq("user_id", authed.user.id)
    .select("id");

  const lineageStamped = !lineageErr && (lineageRows?.length ?? 0) > 0;
  if (!lineageStamped) {
    return NextResponse.json(
      {
        job_id: row.job_id,
        song_id: row.song_id,
        status: row.status,
        remixed_from: null,
        warning: "lineage_stamp_failed",
        distance: body.distance ?? DEFAULT_REMIX_DISTANCE,
      },
      { status: 202 },
    );
  }

  return NextResponse.json(
    {
      job_id: row.job_id,
      song_id: row.song_id,
      status: row.status,
      remixed_from: parentRow.id,
      distance: body.distance ?? DEFAULT_REMIX_DISTANCE,
    },
    { status: 202 },
  );
}
