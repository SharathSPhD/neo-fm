/**
 * POST /api/songs/[id]/remix
 *
 * Forks an existing song into a new generation job. The new job:
 *
 *   - Reuses the same lyrics, sections, style_family, language, and target
 *     duration as the parent.
 *   - Mutates exactly one creative knob so the remix sounds different:
 *     tempo BPM is perturbed by ±15 (clamped to the doc schema range).
 *   - Has its title suffixed with " (remix)".
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

import { requireUser } from "@/lib/supabase/auth";
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
    language: "en" | "hi" | "kn";
    style_family: "western" | "carnatic" | "hindustani" | "kannada-folk";
    document_json: Record<string, unknown> & {
      target_duration_seconds?: number;
      tempo_bpm?: number;
      title?: string;
    };
  } | null;
};

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

  // Clone + mutate the song doc. We do a JSON deep-clone via stringify
  // because the doc is a Json/plain-object tree.
  const cloned = JSON.parse(JSON.stringify(parentDoc.document_json)) as Record<
    string,
    unknown
  > & {
    title?: string;
    tempo_bpm?: number;
    target_duration_seconds?: number;
  };

  // Title suffix; cap at the schema's 120-char limit. We accept titles
  // either embedded inside document_json (older shape) or stored on the
  // song_documents row (canonical).
  const baseTitle = (cloned.title ?? parentDoc.title ?? "Untitled").trim();
  cloned.title = (baseTitle.endsWith("(remix)")
    ? baseTitle
    : `${baseTitle} (remix)`
  ).slice(0, 120);

  // Tempo perturbation. The song-doc schema clamps tempo_bpm to 30..240,
  // so we clamp the result there too. A ±15 BPM jitter is audible but
  // keeps the remix recognisable. We don't perturb if the parent doesn't
  // have a tempo (some doc shapes leave it implicit).
  if (typeof cloned.tempo_bpm === "number") {
    const delta = Math.floor(Math.random() * 31) - 15; // -15..+15
    const next = cloned.tempo_bpm + (delta === 0 ? 5 : delta);
    cloned.tempo_bpm = Math.max(30, Math.min(240, next));
  }

  // Validate the mutated doc through the shared zod schema so an upstream
  // worker never sees a corrupted document. Reject cleanly otherwise.
  const docCheck = SongDocumentSchema.safeParse(cloned);
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
      p_language: parentDoc.language,
      p_style_family: parentDoc.style_family,
      p_target_duration_seconds: validatedDoc.target_duration_seconds,
      p_priority: 0,
      p_attempt_id: attempt_id,
      p_trace_id: trace_id,
    },
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

  // Stamp the lineage. RLS lets the owner UPDATE their own jobs, and
  // create_song_job() already wrote the row as the authenticated user.
  const { error: lineageErr } = await supabase
    .from("jobs")
    .update({ remixed_from: parentRow.id })
    .eq("id", row.job_id);

  if (lineageErr) {
    // The remix succeeded; we just couldn't tag it. Return the job
    // anyway so the user isn't blocked.
    return NextResponse.json(
      {
        job_id: row.job_id,
        song_id: row.song_id,
        status: row.status,
        remixed_from: null,
        warning: "lineage_stamp_failed",
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
    },
    { status: 202 },
  );
}
