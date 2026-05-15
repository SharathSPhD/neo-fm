/**
 * /api/songs
 *
 *   POST  -- accept a song document (or a prompt, behind a 501 stub for
 *            Phase 10), and atomically: persist the document, create a
 *            jobs row, enqueue a pgmq message. Returns
 *            `{ job_id, status, song_id }`.
 *
 *   GET   -- list the authenticated user's songs (most recent first),
 *            with a simple cursor.
 *
 * Job creation goes through `public.create_song_job`, a SECURITY DEFINER
 * RPC that runs as `auth.uid()` and:
 *
 *   1. takes a per-user transaction-scoped advisory lock (no quota TOCTOU);
 *   2. re-checks the monthly tier quota under that lock (ADR 0009);
 *   3. re-checks the per-tier storage byte cap under the same lock (ADR 0005);
 *   4. inserts the song_document + jobs row scoped to the calling user;
 *   5. enqueues a pgmq message.
 *
 * Direct INSERT on `public.song_documents` / `public.jobs` is revoked from
 * the `authenticated` role (see migration 0008), so this RPC is the *only*
 * path that can create jobs -- closing the "bypass /api/songs via
 * PostgREST" hole flagged in the Phase 4 adversarial review.
 */
import { getCoComposer } from "@neo-fm/co-composer";
import { allocateSectionDurations, SongDocumentSchema } from "@neo-fm/song-doc";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  CreateSongRequestSchema,
  ListSongsQuerySchema,
} from "../../../lib/api/song-schemas";
import { requireUser } from "../../../lib/supabase/auth";
import type { Json } from "../../../lib/supabase/database.types";

export const dynamic = "force-dynamic";

const PROMPT_BRANCH_ENABLED =
  process.env.NEO_FM_PROMPT_BRANCH_ENABLED === "true";

type SongListRow = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  song_document_id: string;
  song_documents: {
    id: string;
    language: string;
    style_family: string;
    document_json: unknown;
    created_at: string;
  } | null;
  tracks:
    | {
        url: string;
        duration_seconds: number | null;
        format: string;
        created_at: string;
      }[]
    | null;
};

/**
 * Pick the most recent track for a job. Multiple track rows can exist when
 * a job was retried under a new attempt_id (ADR 0008); without explicit
 * ordering, PostgREST nested-select order is undefined and a user could be
 * handed an older attempt's audio. The query returns tracks
 * `order by created_at desc`, but we also sort defensively in JS so a
 * future schema change can't silently regress this.
 */
function latestTrack(
  rows: SongListRow["tracks"],
): SongListRow["tracks"] extends Array<infer T> | null ? T | undefined : never {
  if (!rows || rows.length === 0) return undefined as never;
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] as never;
}

/**
 * Seconds remaining until the next UTC month rollover. Used to populate
 * `remaining_seconds_until_reset` on the rows-per-month quota error so the
 * client can render a meaningful "try again in N hours" indicator.
 */
function secondsUntilNextUtcMonth(now: Date = new Date()): number {
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return Math.floor((nextMonth.getTime() - now.getTime()) / 1000);
}

export async function POST(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  // ----- 1. parse + validate request body --------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = CreateSongRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.prompt && !PROMPT_BRANCH_ENABLED) {
    return NextResponse.json(
      { error: "prompt_branch_not_yet_enabled" },
      { status: 501 },
    );
  }

  if (!parsed.data.song_document) {
    // Prompt-branch with the flag on would hand off to Pratyabhijna here.
    return NextResponse.json(
      { error: "prompt_branch_not_yet_enabled" },
      { status: 501 },
    );
  }

  // Re-validate after `allocateSectionDurations` -- the helper fills in any
  // unset target_seconds before the full superRefine runs.
  const allocated = allocateSectionDurations(parsed.data.song_document);
  const docCheck = SongDocumentSchema.safeParse(allocated);
  if (!docCheck.success) {
    return NextResponse.json(
      { error: "invalid_song_document", details: docCheck.error.flatten() },
      { status: 400 },
    );
  }
  const validated_document = docCheck.data;

  // --- Co-composer hot path -----------------------------------------------
  //
  // The adversarial review (Phase 1 of v1-finish plan) flagged that the
  // /api/songs hot path was forwarding the user-supplied Song Document
  // verbatim to the worker -- so HeartMuLa never saw the composer's tags
  // for ANY style. The user could request `style_family: carnatic` and
  // the model would receive only the section types + lyrics, with no
  // raga / tala / instrumentation conditioning.
  //
  // We elaborate before persistence so the stored document IS the
  // elaborated one. The detail page (Sprint 2) will render exactly what
  // got generated; the worker forwards exactly what got stored. No
  // hidden state.
  //
  // Producer-supplied tags / raga / tala still win (see tag-merge.ts).
  let song_document = validated_document;
  try {
    const cc = getCoComposer(validated_document.style_family);
    song_document = await cc.elaborate(validated_document);
    // Defence in depth: the composer should never produce a document
    // that fails the schema (its tests enforce this), but if it
    // somehow does, surface as a 500 rather than silently DLQ later.
    const elaboratedCheck = SongDocumentSchema.safeParse(song_document);
    if (!elaboratedCheck.success) {
      return NextResponse.json(
        {
          error: "co_composer_emitted_invalid_document",
          details: elaboratedCheck.error.flatten(),
        },
        { status: 500 },
      );
    }
    song_document = elaboratedCheck.data;
  } catch (err) {
    // A composer reject (e.g. mismatched style/raga combination that
    // slipped past Zod, or an unsupported tempo) is a 400 -- it tells
    // the user their inputs were not compatible. Distinct from a 500
    // (the composer crashed on what should have been a valid doc).
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "co_composer_rejected", details: message },
      { status: 400 },
    );
  }

  // ----- 2. atomic create_song_job RPC ----------------------------------
  // Bundles: per-user advisory lock, quota check, song_document insert,
  // jobs insert, pgmq enqueue. All-or-nothing.
  const trace_id = randomUUID();
  const attempt_id = randomUUID();

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "create_song_job",
    {
      p_song_document: song_document as unknown as Json,
      p_language: song_document.language,
      p_style_family: song_document.style_family,
      p_target_duration_seconds: song_document.target_duration_seconds,
      p_priority: 0,
      p_attempt_id: attempt_id,
      p_trace_id: trace_id,
    } as never,
  );

  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    // ADR 0005: per-tier storage byte cap. Different reset semantics
    // (reset happens when the user deletes a song or the sweep prunes
    // expired tracks); we return -1 to make that explicit on the client.
    // Match `storage_quota_exceeded` BEFORE `quota_exceeded` because the
    // shorter literal is a substring of the longer one.
    if (msg.includes("storage_quota_exceeded")) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          reason: "storage_bytes",
          remaining_seconds_until_reset: -1,
        },
        { status: 429 },
      );
    }
    // ADR 0009: rows-per-month quota. Reset is the next UTC month rollover.
    if (msg.includes("quota_exceeded")) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          reason: "rows_per_month",
          remaining_seconds_until_reset: secondsUntilNextUtcMonth(),
        },
        { status: 429 },
      );
    }
    if (msg.includes("unauthenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (msg.includes("invalid_target_duration_seconds")) {
      return NextResponse.json(
        { error: "invalid_song_document", details: msg },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "create_song_job_failed", details: msg },
      { status: 500 },
    );
  }

  // create_song_job returns SETOF (...); supabase-js wraps that as a single
  // array. Defensive-pick the first row.
  const row = Array.isArray(rpcData) ? rpcData[0] : null;
  if (!row) {
    return NextResponse.json(
      { error: "create_song_job_failed" },
      { status: 500 },
    );
  }

  // user.id is unused on the response shape now that the RPC owns the row,
  // but keep the dependency so the user/auth assertion runs before the RPC.
  void user;

  return NextResponse.json(
    { job_id: row.job_id, status: row.status, song_id: row.song_id },
    { status: 202 },
  );
}

export async function GET(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { searchParams } = new URL(request.url);
  const parsed = ListSongsQuerySchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let q = supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      error,
      created_at,
      finished_at,
      song_document_id,
      song_documents (
        id, language, style_family, document_json, created_at
      ),
      tracks (
        url, duration_seconds, format, created_at
      )
    `,
    )
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "tracks", ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.cursor) {
    q = q.lt("created_at", parsed.data.cursor);
  }

  const { data, error } = await (q.returns<SongListRow[]>());
  if (error) {
    return NextResponse.json(
      { error: "list_failed", details: error.message },
      { status: 500 },
    );
  }

  const items = (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    finished_at: row.finished_at,
    song_document: row.song_documents,
    track: latestTrack(row.tracks),
  }));

  const next_cursor =
    items.length === parsed.data.limit
      ? items[items.length - 1]?.created_at
      : undefined;

  return NextResponse.json({ items, next_cursor });
}
