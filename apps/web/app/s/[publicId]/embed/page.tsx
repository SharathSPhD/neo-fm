/**
 * /s/[publicId]/embed -- minimal iframe-friendly view for the public song.
 *
 * Aimed at Substack / Notion / blogs that embed via `<iframe>`. Strips
 * navigation and metadata; keeps only the title strip + the audio
 * player + a "Made with neo-fm" link. Same ADR 0013 / RLS gate as
 * the full /s/[publicId] page.
 *
 * Query: ?layout=compact|full (default full), ?theme=light|dark|auto
 * (default auto). Private and taken-down songs fall through to
 * ./not-found.tsx.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

import { parseEmbedOptions } from "@/lib/embed/options";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

import { EmbedPlayer } from "./embed-player";

export const dynamic = "force-dynamic";

// The player is a widget, not a destination: the song page is what should rank.
export const metadata: Metadata = { title: "neo-fm player", robots: { index: false, follow: false } };

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
      sections?: { id: string; type: string; target_seconds: number; lyrics?: string }[];
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
  searchParams,
}: {
  params: { publicId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) notFound();
  const { layout, theme } = parseEmbedOptions(searchParams);
  const compact = layout === "compact";
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

  const title = data.song_documents?.title?.trim()?.length
    ? data.song_documents.title
    : doc
      ? prettyStyle(doc.style_family)
      : "Song";
  const colorScheme = theme === "auto" ? "light dark" : theme;

  return (
    <main
      className={`embed-root flex min-h-screen flex-col justify-between gap-3 px-4 py-3`}
      data-embed-theme={theme}
      style={{ colorScheme }}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <header className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium" title={title ?? undefined}>
            {title}
            {!compact && doc ? (
              <span className="ml-2 text-xs text-foreground/60">{prettyLanguage(doc.language)}</span>
            ) : null}
          </span>
          {compact ? (
            <a
              href={`/s/${data.public_id}`}
              target="_top"
              rel="noopener"
              className="shrink-0 text-[10px] uppercase tracking-widest text-foreground/60 hover:text-foreground"
            >
              Made with neo-fm ↗
            </a>
          ) : null}
        </header>
        {signedUrl && latestTrack ? (
          <EmbedPlayer
            publicId={data.public_id}
            initialUrl={signedUrl}
            durationSeconds={latestTrack.duration_seconds}
            format={latestTrack.format}
            sections={doc?.sections ?? []}
            layout={layout}
            language={doc?.language ?? "en"}
          />
        ) : (
          <p className="text-xs text-foreground/70">
            {data.status === "queued" || data.status === "processing"
              ? "Rendering now."
              : "Audio preview not available."}
          </p>
        )}
      </div>
      {compact ? null : (
        <a
          href={`/s/${data.public_id}`}
          target="_top"
          rel="noopener"
          className="self-end text-[10px] uppercase tracking-widest text-foreground/60 hover:text-foreground"
        >
          Made with neo-fm ↗
        </a>
      )}
    </main>
  );
}
