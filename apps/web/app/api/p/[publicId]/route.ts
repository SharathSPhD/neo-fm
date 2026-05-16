/**
 * GET /api/p/[publicId]
 *
 * Unauthenticated read of a published song. Returns minimal payload:
 *   { public_id, status, style_family, language, target_duration_seconds,
 *     song_document, visibility, published_at }
 *
 * Backed by ADR 0013 RLS widening: the `jobs_select_public`,
 * `song_documents_select_public`, and `tracks_select_public` policies
 * make rows visible only when `published_visibility in ('public','unlisted')`
 * and `public_id is not null`.
 *
 * Returns 404 for unknown / unpublished / re-privatized songs (we use the
 * same shape so the existence of private songs isn't leaked).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createServerClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

// Crockford base32, 10 chars.
const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

export async function GET(
  _request: NextRequest,
  { params }: { params: { publicId: string } },
) {
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const publicId = idCheck.data;

  // createServerClient is unauth-safe: when there is no Supabase session
  // cookie it acts as the `anon` role, which is exactly what ADR 0013 RLS
  // allows for published rows.
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      public_id,
      published_at,
      published_visibility,
      song_documents (
        document_json,
        language,
        style_family,
        title
      )
    `,
    )
    .eq("public_id", publicId)
    .in("published_visibility", ["public", "unlisted"])
    .maybeSingle<{
      id: string;
      status: string;
      public_id: string;
      published_at: string;
      published_visibility: "public" | "unlisted" | "private";
      song_documents: {
        document_json: Record<string, unknown>;
        language: string;
        style_family: string;
        title: string | null;
      } | null;
    }>();

  if (error) {
    return NextResponse.json(
      { error: "lookup_failed", details: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      public_id: data.public_id,
      status: data.status,
      visibility: data.published_visibility,
      published_at: data.published_at,
      title: data.song_documents?.title ?? null,
      language: data.song_documents?.language,
      style_family: data.song_documents?.style_family,
      song_document: data.song_documents?.document_json ?? null,
    },
    {
      headers: {
        // Short cache to keep load light without making revoke take ages.
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
