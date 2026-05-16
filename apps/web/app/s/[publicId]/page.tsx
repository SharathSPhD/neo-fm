/**
 * /s/[publicId] -- public song page (M1, ADR 0013).
 *
 * Server component. Anonymous-readable when the underlying job has
 * `published_visibility in ('public','unlisted')` and `public_id` set.
 * Renders:
 *   - song headline (style, language, length, raga/tala)
 *   - per-section breakdown with lyrics (read-only)
 *   - <audio> with ADR 0012 Tier-1 signed URL + <PublicSongAudio>
 *     client component handling Tier-2 refresh via /api/p/[publicId]/audio-url
 *
 * OG metadata is emitted via `generateMetadata` so Slack / iMessage /
 * X / Discord link previews work for unauthenticated previewers. The
 * dynamic OG image is at `./opengraph-image`.
 *
 * Robots: `unlisted` -> noindex, `public` -> index.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";

import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

import { PublicSongAudio } from "./public-song-audio";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

interface SectionView {
  id: string;
  type: string;
  target_seconds: number;
  lyrics?: string;
  script?: string;
  transliteration?: string;
  tags?: string[];
}

interface RagaView {
  name: string;
  system: string;
  arohana?: string[];
  avarohana?: string[];
}

interface OrchestrationView {
  lead_vocal?: string;
  instruments?: string[];
  texture?: string;
}

interface SongDocumentView {
  style_family: string;
  language: string;
  target_duration_seconds: number;
  tempo_bpm?: number;
  time_signature?: string;
  tala?: string;
  raga?: RagaView;
  orchestration?: OrchestrationView;
  sections: SectionView[];
}

interface PublicSongRow {
  id: string;
  status: string;
  public_id: string;
  published_at: string | null;
  published_visibility: "public" | "unlisted" | "private";
  song_documents: {
    document_json: SongDocumentView;
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

async function loadPublicSong(publicId: string): Promise<PublicSongRow | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      public_id,
      published_at,
      published_visibility,
      song_documents (
        document_json, language, style_family, title
      ),
      tracks (
        id, url, duration_seconds, format, created_at
      )
    `,
    )
    .eq("public_id", publicId)
    .in("published_visibility", ["public", "unlisted"])
    .order("created_at", { referencedTable: "tracks", ascending: false })
    .maybeSingle<PublicSongRow>();
  return data ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: { publicId: string };
}): Promise<Metadata> {
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) {
    return { title: "neo-fm" };
  }
  const data = await loadPublicSong(idCheck.data);
  if (!data || !data.song_documents) {
    return { title: "neo-fm" };
  }
  const doc = data.song_documents.document_json;
  const stored = data.song_documents.title?.trim();
  const title =
    stored && stored.length > 0
      ? stored
      : `${prettyStyle(doc.style_family)} song in ${prettyLanguage(doc.language)}`;
  const description = doc.raga
    ? `Composed in raga ${doc.raga.name} (${doc.raga.system}). Generated on neo-fm.`
    : `${doc.target_duration_seconds}s composition generated on neo-fm.`;
  const robots =
    data.published_visibility === "unlisted"
      ? { index: false, follow: false }
      : { index: true, follow: true };
  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      type: "music.song",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function PublicSongPage({
  params,
}: {
  params: { publicId: string };
}) {
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) notFound();

  const data = await loadPublicSong(idCheck.data);
  if (!data) notFound();
  const doc = data.song_documents?.document_json;
  const storedTitle = data.song_documents?.title?.trim();
  const displayTitle =
    storedTitle && storedTitle.length > 0
      ? storedTitle
      : doc
        ? prettyStyle(doc.style_family)
        : "Song";

  let signedUrl: string | null = null;
  let latestTrack: PublicSongRow["tracks"] extends (infer T)[] | null
    ? T | undefined
    : never = undefined;
  const tracks = (data.tracks ?? [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  latestTrack = tracks[0];
  if (latestTrack && data.status === "completed") {
    // RLS lets anon read the tracks row, but the storage bucket is
    // still private (ADR 0013). Use service-role to mint the signed URL.
    const svc = createServiceRoleClient();
    const objectPath = latestTrack.url.replace(/^tracks\//, "");
    const { data: signed } = await svc.storage
      .from("tracks")
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    signedUrl = signed?.signedUrl ?? null;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-[11px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70"
        >
          neo-fm
        </Link>
        <h1 className="text-3xl font-medium tracking-tight">
          {displayTitle}
        </h1>
        <p className="text-sm text-foreground/60">
          {doc
            ? `${prettyStyle(doc.style_family)} · ${prettyLanguage(doc.language)} · ${doc.target_duration_seconds}s`
            : ""}
          {data.published_visibility === "unlisted" ? (
            <span className="ml-2 rounded bg-muted/20 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-foreground/50">
              unlisted
            </span>
          ) : null}
        </p>
      </header>

      {signedUrl && latestTrack ? (
        <section className="flex flex-col gap-2">
          <PublicSongAudio
            publicId={data.public_id}
            initialUrl={signedUrl}
            durationSeconds={latestTrack.duration_seconds}
            format={latestTrack.format}
          />
        </section>
      ) : (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          Audio is still being prepared. Refresh in a moment.
        </p>
      )}

      {doc ? <SongMetadata doc={doc} /> : null}

      {doc ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-foreground/50">
            Sections
          </h2>
          <ol className="flex flex-col gap-3">
            {doc.sections.map((s, idx) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-md border border-muted/20 bg-muted/5 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                      {idx + 1}.
                    </span>
                    <span className="text-sm font-medium">
                      {prettySectionType(s.type)}
                    </span>
                    <span className="text-[10px] text-foreground/40">
                      {s.target_seconds}s
                    </span>
                  </div>
                </div>
                {s.lyrics ? (
                  <pre
                    className={`whitespace-pre-wrap rounded-md bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground/85 ${
                      s.script === "devanagari" || s.script === "kannada"
                        ? "font-sans"
                        : "font-sans"
                    }`}
                  >
                    {s.lyrics}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-muted/10 pt-4 text-[10px] text-foreground/40">
        <span>Generated on neo-fm</span>
        <Link href="/" className="hover:text-foreground/70">
          Make your own →
        </Link>
      </footer>
    </main>
  );
}

function SongMetadata({ doc }: { doc: SongDocumentView }) {
  const rows: { label: string; value: string }[] = [];
  if (doc.tempo_bpm) rows.push({ label: "Tempo", value: `${doc.tempo_bpm} BPM` });
  if (doc.time_signature)
    rows.push({ label: "Time signature", value: doc.time_signature });
  if (doc.tala) rows.push({ label: "Tala", value: doc.tala });
  if (doc.raga) {
    rows.push({
      label: "Raga",
      value: `${doc.raga.name} (${doc.raga.system})`,
    });
    if (doc.raga.arohana?.length)
      rows.push({ label: "Arohana", value: doc.raga.arohana.join(" ") });
    if (doc.raga.avarohana?.length)
      rows.push({ label: "Avarohana", value: doc.raga.avarohana.join(" ") });
  }
  if (doc.orchestration) {
    if (doc.orchestration.lead_vocal)
      rows.push({ label: "Lead vocal", value: doc.orchestration.lead_vocal });
    if (doc.orchestration.instruments?.length)
      rows.push({
        label: "Instruments",
        value: doc.orchestration.instruments.join(", "),
      });
    if (doc.orchestration.texture)
      rows.push({ label: "Texture", value: doc.orchestration.texture });
  }
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        Composition
      </h2>
      <dl className="grid gap-1 sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-3 rounded-md border border-muted/10 bg-muted/5 px-3 py-2"
          >
            <dt className="text-[10px] uppercase tracking-widest text-foreground/40">
              {r.label}
            </dt>
            <dd className="font-mono text-xs text-foreground/80">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
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

function prettySectionType(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ");
}
