/**
 * GET /api/lyrics?language=hi
 *
 * Returns the bundled public-domain lyric corpus filtered by language. The
 * Sprint 2 "library picker" side-panel in the creation canvas calls this
 * to populate its grid of lyric cards. Each entry carries enough metadata
 * (author, title, source citation, script) for the panel to render the
 * card AND to surface a tooltip that confirms PD provenance to the user.
 *
 * Auth: requires a signed-in user. The corpus itself is public domain so
 * the data is not sensitive, but gating the endpoint avoids opening an
 * unauthenticated abuse vector and means we can rate-limit it via the
 * same middleware as the rest of the API.
 *
 * Caching: response is small (a few KB per language), changes only when
 * we add a new lyric, and is identical across users. The Cache-Control
 * header sets a moderate stale-while-revalidate so an authenticated
 * client can fetch this once per session.
 */
import { bundledCorpusForLanguage } from "@neo-fm/lyrics";
import { LanguageSchema } from "@neo-fm/song-doc";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const LyricsQuerySchema = z.object({
  language: LanguageSchema,
});

export async function GET(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  const { searchParams } = new URL(request.url);
  const parsed = LyricsQuerySchema.safeParse({
    language: searchParams.get("language") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const entries = bundledCorpusForLanguage(parsed.data.language);

  // Strip body to a short snippet for the listing view; the editor will
  // pull the full body when the user actually picks one. This keeps the
  // payload small even if the corpus grows.
  const SNIPPET_CHARS = 280;
  const items = entries.map((e) => ({
    id: e.id,
    title: e.title,
    author: e.author,
    language: e.language,
    script: e.script,
    snippet:
      e.body.length > SNIPPET_CHARS
        ? `${e.body.slice(0, SNIPPET_CHARS).trimEnd()}…`
        : e.body,
    source_url: e.source_url,
    source_citation: e.source_citation,
  }));

  return NextResponse.json(
    { items },
    {
      headers: {
        "cache-control": "private, max-age=300, stale-while-revalidate=600",
      },
    },
  );
}
