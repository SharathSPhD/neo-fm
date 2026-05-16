/**
 * /s/[publicId]/embed -- minimal iframe-friendly view for the public song.
 *
 * Aimed at Substack / Notion / blogs that embed via `<iframe>`. Strips
 * navigation and metadata; keeps only the title strip + the audio
 * player + a small "Play on neo-fm" link. Same ADR 0013 / RLS gate as
 * the full /s/[publicId] page.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

import { PublicSongAudio } from "../public-song-audio";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

interface EmbedRow {
  id: string;
  status: string;
  public_id: string;
  published_visibility: "public" | "unlisted" | "private";
  song_documents: {
    document_json: {
      style_family: string;
      language: string;
      target_duration_seconds: number;
      raga?: { name: string };
    };
    language: string;
    style_family: string;
    title: string | null;
  } | null;
  tracks:
    | {
        id: string;
        url: string;
        duration_seconds: number | null;
        format: string;
        created_at: string;
      }[]
    | null;
}

export default async function EmbedPage({
  params,
}: {
  params: { publicId: string };
}) {
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) notFound();

  const supabase = createServerClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      public_id,
      published_visibility,
      song_documents ( document_json, language, style_family, title ),
      tracks ( id, url, duration_seconds, format, created_at )
    `,
    )
    .eq("public_id", idCheck.data)
    .in("published_visibility", ["public", "unlisted"])
    .order("created_at", { referencedTable: "tracks", ascending: false })
    .maybeSingle<EmbedRow>();

  if (!data) notFound();
  const doc = data.song_documents?.document_json;

  const tracks = (data.tracks ?? [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const latestTrack = tracks[0];

  let signedUrl: string | null = null;
  if (latestTrack && data.status === "completed") {
    const svc = createServiceRoleClient();
    const objectPath = latestTrack.url.replace(/^tracks\//, "");
    const { data: signed } = await svc.storage
      .from("tracks")
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    signedUrl = signed?.signedUrl ?? null;
  }

  return (
    <main className="flex h-full min-h-[160px] flex-col gap-3 bg-background px-4 py-4">
      <header className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium" title={data.song_documents?.title ?? undefined}>
          {data.song_documents?.title?.trim()?.length
            ? data.song_documents.title
            : doc
              ? prettyStyle(doc.style_family)
              : "Song"}
          <span className="ml-2 text-xs text-foreground/50">
            {doc ? prettyLanguage(doc.language) : ""}
          </span>
        </span>
        <Link
          href={`/s/${data.public_id}`}
          target="_top"
          className="text-[10px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70"
        >
          neo-fm ↗
        </Link>
      </header>
      {signedUrl && latestTrack ? (
        <PublicSongAudio
          publicId={data.public_id}
          initialUrl={signedUrl}
          durationSeconds={latestTrack.duration_seconds}
          format={latestTrack.format}
        />
      ) : (
        <p className="text-xs text-amber-200">Audio is still being prepared.</p>
      )}
    </main>
  );
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
