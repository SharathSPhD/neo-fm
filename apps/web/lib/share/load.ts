/**
 * Loads what the share cards need for a public/unlisted song. Private
 * songs (and unknown ids) return null, so nothing about them can be
 * rendered into a cacheable image.
 */
import { z } from "zod";

import { prettyLanguage, prettyStyle } from "@/lib/song/labels";
import { createServerClient } from "@/lib/supabase/server";

import { pickExcerpt } from "./card";

export const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

export interface Dedication {
  to: string;
  message: string | null;
}

export interface ShareSong {
  publicId: string;
  title: string;
  subtitle: string;
  excerpt: string[];
  dedication: Dedication | null;
}

/**
 * Dedication lives in separate columns read by their own query so a
 * deploy that lands before the 0074 migration degrades to "no
 * dedication" instead of breaking the song page or its card.
 */
export async function loadDedication(
  publicId: string,
): Promise<Dedication | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await (
      supabase.from("jobs") as unknown as {
        select: (c: string) => {
          eq: (k: string, v: string) => {
            in: (
              k: string,
              v: string[],
            ) => {
              maybeSingle: () => Promise<{
                data: { dedication_to: string | null; dedication_message: string | null } | null;
                error: unknown;
              }>;
            };
          };
        };
      }
    )
      .select("dedication_to, dedication_message")
      .eq("public_id", publicId)
      .in("published_visibility", ["public", "unlisted"])
      .maybeSingle();
    if (error || !data?.dedication_to) return null;
    return { to: data.dedication_to, message: data.dedication_message };
  } catch {
    return null;
  }
}

export async function loadShareSong(
  rawPublicId: string,
): Promise<ShareSong | null> {
  const idCheck = PublicIdSchema.safeParse(rawPublicId);
  if (!idCheck.success) return null;
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
      song_documents: {
        document_json: {
          style_family: string;
          language: string;
          target_duration_seconds: number;
          raga?: { name: string };
          sections?: { type?: string; lyrics?: string; script?: string }[];
        };
        title: string | null;
      } | null;
    }>();
  if (!data?.song_documents) return null;
  const doc = data.song_documents.document_json;
  const stored = data.song_documents.title?.trim();
  return {
    publicId: data.public_id,
    title: stored ? stored : `${prettyStyle(doc.style_family)} song`,
    subtitle: doc.raga
      ? `${prettyStyle(doc.style_family)} · raga ${doc.raga.name} · ${prettyLanguage(doc.language)} · neo-fm`
      : `${prettyStyle(doc.style_family)} · ${prettyLanguage(doc.language)} · ${doc.target_duration_seconds}s · neo-fm`,
    excerpt: pickExcerpt(doc.sections),
    dedication: await loadDedication(data.public_id),
  };
}
