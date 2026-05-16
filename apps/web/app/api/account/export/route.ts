/**
 * GET /api/account/export
 *
 * Builds a JSON dump of the authenticated user's data: profile,
 * songs, song_documents, and (signed-URL-free) track metadata. We
 * deliberately do not embed the audio bytes -- the response would
 * blow past Vercel's 4.5 MB serverless body cap for any user with
 * more than a handful of songs. The user can re-download each
 * audio file from /library after the export.
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  const [{ data: profile }, { data: jobs }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, tier, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(
        `
        id,
        status,
        error,
        created_at,
        finished_at,
        public_id,
        published_visibility,
        song_documents (
          id, language, style_family, document_json, title, created_at
        ),
        tracks (
          id, url, duration_seconds, format, bytes, created_at
        )
      `,
      )
      .order("created_at", { ascending: false }),
  ]);

  const payload = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    user: profile ?? { id: user.id, email: user.email ?? null },
    songs: jobs ?? [],
  };

  const body = JSON.stringify(payload, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="neo-fm-export-${user.id.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  });
}
