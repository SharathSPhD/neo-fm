/**
 * /api/songs/[id]/cover-art
 *
 * v1.3 Sprint 3 — cover-art generation routes through DGX, not HF inference.
 *
 *   POST  — enqueue a cover-art job. Calls the `enqueue_cover_art_job`
 *           SECURITY DEFINER RPC, which validates ownership, inserts a
 *           `public.cover_art_attempts` row, and `pgmq.send`s onto
 *           `cover_art_jobs` in a single transaction. The DGX worker's
 *           cover-art consumer drains the queue, calls
 *           `services/cover-art-synth`, uploads to Storage, and inserts
 *           the artefact row. Returns 202 + `{ attempt_id, status }`.
 *
 *   GET    — returns the most-recent attempt's status (queued / processing
 *            / failed / dlq) along with the most-recent `public.cover_art`
 *            row's signed URL (1h TTL). The UI polls this endpoint while
 *            generation is in flight.
 *
 * The HF token path is gone — Vercel never calls a GPU sidecar in-request
 * (ADR 0003). Direct INSERT on `cover_art_attempts` is revoked from
 * `authenticated`, so the RPC is the only sanctioned path.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const dynamic = "force-dynamic";

interface SongRow {
  id: string;
  song_documents: {
    title: string | null;
    language: string;
    style_family: string;
    document_json: {
      raga?: { name?: string };
      orchestration?: { texture?: string };
    } | null;
  } | null;
}

interface AttemptRow {
  attempt_id: string;
  status: string;
  error: string | null;
  storage_path: string | null;
  model_version: string | null;
  created_at: string;
  updated_at: string;
}

interface CoverArtRow {
  url: string;
  created_at: string;
}

function buildPrompt(row: SongRow): string {
  const title = row.song_documents?.title?.trim() ?? "an Indian classical song";
  const style = row.song_documents?.style_family ?? "world";
  const raga = row.song_documents?.document_json?.raga?.name;
  const texture = row.song_documents?.document_json?.orchestration?.texture;
  const parts = [
    `Album cover art for "${title}"`,
    `${style} musical style`,
    raga ? `raga ${raga}` : null,
    texture ? `${texture} texture` : null,
    "elegant, atmospheric, no text, no watermarks, square 1:1, 4k",
  ].filter(Boolean);
  return parts.join(", ");
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  // Latest attempt (queued/processing/completed/failed/dlq).
  const attemptProbe = (await (
    supabase.from("cover_art_attempts" as never) as unknown as {
      select: (s: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{ data: AttemptRow | null }>;
            };
          };
        };
      };
    }
  )
    .select("attempt_id, status, error, storage_path, model_version, created_at, updated_at")
    .eq("job_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: AttemptRow | null };

  // Latest artefact (is_current=true) — independent of the attempt
  // because a queued re-roll still shows the previous cover art.
  const artProbe = (await (
    supabase.from("cover_art" as never) as unknown as {
      select: (s: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          eq: (
            col2: string,
            val2: boolean,
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{ data: CoverArtRow | null }>;
              };
            };
          };
        };
      };
    }
  )
    .select("url, created_at")
    .eq("job_id", params.id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: CoverArtRow | null };

  let signedUrl: string | null = null;
  if (artProbe.data) {
    const objectPath = artProbe.data.url.replace(/^cover-art\//, "");
    const { data: signed } = await supabase.storage
      .from("cover-art")
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    signedUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    url: signedUrl,
    created_at: artProbe.data?.created_at ?? null,
    attempt: attemptProbe.data
      ? {
          attempt_id: attemptProbe.data.attempt_id,
          status: attemptProbe.data.status,
          error: attemptProbe.data.error,
          updated_at: attemptProbe.data.updated_at,
        }
      : null,
  });
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
  const { supabase } = authed;

  // Pull song metadata so the worker has a tasteful prompt. Ownership is
  // enforced by both RLS here and the SECURITY DEFINER RPC below.
  const { data: song, error: songErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      song_documents (
        title, language, style_family, document_json
      )
    `,
    )
    .eq("id", params.id)
    .maybeSingle<SongRow>();
  if (songErr || !song?.song_documents) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const prompt = buildPrompt(song);
  const attemptId = randomUUID();
  const traceId = randomUUID();

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "enqueue_cover_art_job",
    {
      p_song_id: params.id,
      p_prompt: prompt,
      p_attempt_id: attemptId,
      p_trace_id: traceId,
    } as never,
  );

  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    if (msg.includes("unauthenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (msg.includes("not_owner") || msg.includes("song_not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (msg.includes("prompt_too_long") || msg.includes("prompt_required")) {
      return NextResponse.json(
        { error: "invalid_prompt", details: msg },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "enqueue_cover_art_failed", details: msg },
      { status: 500 },
    );
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : null;
  if (!row) {
    return NextResponse.json(
      { error: "enqueue_cover_art_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      attempt_id: row.attempt_id,
      status: row.status,
      prompt,
    },
    { status: 202 },
  );
}
