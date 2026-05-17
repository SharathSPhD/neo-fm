/**
 * POST /api/songs/publish-batch
 *
 * Publishes N songs in one transaction. Used by the library toolbar's
 * batch action ("Publish selected (public/unlisted)").
 *
 * Body: `{ job_ids: string[], visibility: 'public' | 'unlisted' | 'private' }`
 *
 * Calls the `publish_song_batch(uuid[], text)` RPC (migration 0040).
 * The RPC:
 *   - enforces the free-tier per-user public cap (≤ 5 public songs
 *     per user) at the DB boundary.
 *   - caps batch size at 100 ids per call.
 *   - returns a per-row outcome so the UI can render an accurate
 *     post-action summary.
 *
 * Returns `{ outcomes: Array<{...}>, summary: { published, quota_hit, ... } }`
 * always with HTTP 200 (the per-row outcomes carry the failures).
 * Only top-level failures (auth, schema, unknown DB error) use non-200.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const PublishBatchBodySchema = z.object({
  job_ids: z
    .array(z.string().uuid())
    .min(1, "at least one job_id required")
    .max(100, "batch size exceeds 100"),
  visibility: z.enum(["public", "unlisted", "private"]),
});

type Outcome =
  | "published"
  | "already_public"
  | "quota_hit"
  | "not_found"
  | "forbidden"
  | "not_completed";

type BatchRow = {
  job_id: string;
  public_id: string | null;
  visibility: "public" | "unlisted" | "private" | null;
  published_at: string | null;
  outcome: Outcome;
};

function emptySummary(): Record<Outcome, number> {
  return {
    published: 0,
    already_public: 0,
    quota_hit: 0,
    not_found: 0,
    forbidden: 0,
    not_completed: 0,
  };
}

export async function POST(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const bodyCheck = PublishBatchBodySchema.safeParse(body);
  if (!bodyCheck.success) {
    return NextResponse.json(
      { error: "invalid_body", details: bodyCheck.error.flatten() },
      { status: 400 },
    );
  }

  // Dedupe — the RPC tolerates duplicates but the summary counts
  // would be confusing.
  const job_ids = Array.from(new Set(bodyCheck.data.job_ids));

  const { data, error } = await supabase.rpc("publish_song_batch", {
    p_job_ids: job_ids,
    p_visibility: bodyCheck.data.visibility,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (code === "22023") {
      return NextResponse.json(
        { error: "validation_failed", details: error.message },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "rpc_failed", details: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as BatchRow[];
  const summary = emptySummary();
  for (const row of rows) {
    summary[row.outcome] = (summary[row.outcome] ?? 0) + 1;
  }

  return NextResponse.json({ outcomes: rows, summary });
}
