/**
 * Dynamic OG image for /s/[publicId] (1200x630, PNG). Uses Next's
 * built-in ImageResponse, so the only runtime dep is a couple of
 * server-side fonts (system fallback is fine for now).
 *
 * Falls back to a generic "Song on neo-fm" card if the publicId
 * doesn't resolve or the song row has been re-privatized.
 */
import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";
import { pickExcerpt } from "@/lib/share/card";
import { renderShareCard } from "@/lib/share/card-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "neo-fm song";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

export default async function OgImage({
  params,
}: {
  params: { publicId: string };
}) {
  let title = "neo-fm";
  let subtitle = "AI music, India-first";
  let excerpt: string[] = [];
  let seed = params.publicId;

  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (idCheck.success) {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("jobs")
      .select(
        `
        public_id,
        published_visibility,
        song_documents ( document_json, language, style_family, title )
      `,
      )
      .eq("public_id", idCheck.data)
      .in("published_visibility", ["public", "unlisted"])
      .maybeSingle<{
        public_id: string;
        published_visibility: "public" | "unlisted" | "private";
        song_documents: {
          document_json: {
            style_family: string;
            language: string;
            target_duration_seconds: number;
            raga?: { name: string };
            sections?: { type?: string; lyrics?: string; script?: string }[];
          };
          language: string;
          style_family: string;
          title: string | null;
        } | null;
      }>();
    // Query is limited to public/unlisted, so private songs never get
    // their lyrics rendered into a cacheable image.
    if (data?.song_documents) {
      const doc = data.song_documents.document_json;
      excerpt = pickExcerpt(doc.sections);
      seed = data.public_id;
      const stored = data.song_documents.title?.trim();
      title =
        stored && stored.length > 0
          ? stored
          : `${prettyStyle(doc.style_family)} song`;
      subtitle = doc.raga
        ? `${prettyStyle(doc.style_family)} · raga ${doc.raga.name} · ${prettyLanguage(doc.language)} · neo-fm`
        : `${prettyStyle(doc.style_family)} · ${prettyLanguage(doc.language)} · ${doc.target_duration_seconds}s · neo-fm`;
    }
  }

  return renderShareCard({ title, subtitle, excerpt, seed });
}

function prettyStyle(s: string): string {
  if (s === "western") return "Western";
  if (s === "carnatic") return "Carnatic";
  if (s === "hindustani") return "Hindustani";
  if (s === "kannada-folk") return "Kannada folk";
  return s;
}
function prettyLanguage(l: string): string {
  if (l === "en") return "English";
  if (l === "hi") return "Hindi";
  if (l === "kn") return "Kannada";
  return l;
}
