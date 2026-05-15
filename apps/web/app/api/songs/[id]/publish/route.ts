/**
 * POST /api/songs/[id]/publish
 *
 * Publishes a completed song. Authenticated owner-only.
 *
 * Body: `{ visibility: 'public' | 'unlisted' | 'private' }`
 *
 * Calls the `publish_song` RPC (ADR 0013) which:
 *   - verifies the caller owns the song and it is `completed`
 *   - mints a stable URL-safe `public_id` slug on first publish
 *   - reuses the slug on any subsequent publish (including re-publish
 *     after unpublish) so shared links survive
 *
 * Returns `{ public_id, visibility, published_at, public_url }` where
 * `public_url` is an absolute URL using `NEXT_PUBLIC_SITE_URL` (falls
 * back to the request host header for previews).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SongIdSchema } from "../../../../../lib/api/song-schemas";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const PublishBodySchema = z.object({
  visibility: z.enum(["public", "unlisted", "private"]),
});

function resolveBaseUrl(request: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) {
    return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  }
  const host = request.headers.get("host") ?? request.nextUrl.host;
  return `${request.nextUrl.protocol}//${host}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const idCheck = SongIdSchema.safeParse(params.id);
  if (!idCheck.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const bodyCheck = PublishBodySchema.safeParse(body);
  if (!bodyCheck.success) {
    return NextResponse.json(
      { error: "invalid_body", details: bodyCheck.error.flatten() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("publish_song", {
    p_job_id: idCheck.data,
    p_visibility: bodyCheck.data.visibility,
  });

  if (error) {
    // Translate Postgres SQLSTATEs into HTTP. publish_song raises:
    //   42501 -> forbidden / unauth
    //   P0002 -> not found
    //   22023 -> validation (e.g. not completed)
    const code = (error as { code?: string }).code;
    if (code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (code === "P0002") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
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

  // publish_song returns SETOF; we expect exactly one row.
  const rows = (data ?? []) as {
    public_id: string | null;
    visibility: "public" | "unlisted" | "private";
    published_at: string | null;
  }[];
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "no_row_returned" }, { status: 500 });
  }

  const baseUrl = resolveBaseUrl(request);
  const publicUrl =
    row.public_id && row.visibility !== "private"
      ? `${baseUrl}/s/${row.public_id}`
      : null;

  return NextResponse.json({
    public_id: row.public_id,
    visibility: row.visibility,
    published_at: row.published_at,
    public_url: publicUrl,
  });
}
