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
import { ReportButton } from "./report-button";
import { serverI18n } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/ui-strings";
import { ProCta } from "@/components/pro-cta";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";

import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import { LikeButton } from "@/components/like-button";
import { RemixButton } from "@/app/(app)/songs/[id]/remix-button";
import { VariationButton } from "@/app/(app)/songs/[id]/variation-button";

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
  voice_id?: string;
  metadata?: { key?: string } & Record<string, unknown>;
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
  const enT: TFn = (k, v) => translate("en", k, v);
  const doc = data.song_documents.document_json;
  const stored = data.song_documents.title?.trim();
  const title =
    stored && stored.length > 0
      ? stored
      : `${prettyStyle(doc.style_family, enT)} song in ${prettyLanguage(doc.language, enT)}`;
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
  const { t } = serverI18n();
  const doc = data.song_documents?.document_json;
  const storedTitle = data.song_documents?.title?.trim();
  const displayTitle =
    storedTitle && storedTitle.length > 0
      ? storedTitle
      : doc
        ? prettyStyle(doc.style_family, t)
        : t("song.song");

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

  // Like state. Anonymous visitors get the count but not their own
  // "liked" state (it's always false). Sprint G feature.
  const supabase = createServerClient();
  const [likesCountRes, currentUserRes] = await Promise.all([
    (
      supabase.from("song_likes" as never) as unknown as {
        select: (
          s: string,
          opts: { count: "exact"; head: true },
        ) => {
          eq: (
            col: string,
            val: string,
          ) => Promise<{ count: number | null }>;
        };
      }
    )
      .select("job_id", { count: "exact", head: true })
      .eq("job_id", data.id),
    supabase.auth.getUser(),
  ]);
  const likeCount = likesCountRes.count ?? 0;
  const currentUserId = currentUserRes.data.user?.id ?? null;
  let initiallyLiked = false;
  if (currentUserId) {
    const probe = await (
      supabase.from("song_likes" as never) as unknown as {
        select: (s: string) => {
          eq: (
            col: string,
            val: string,
          ) => {
            eq: (
              col2: string,
              val2: string,
            ) => {
              maybeSingle: () => Promise<{ data: unknown }>;
            };
          };
        };
      }
    )
      .select("job_id")
      .eq("job_id", data.id)
      .eq("user_id", currentUserId)
      .maybeSingle();
    initiallyLiked = !!probe.data;
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
            ? `${prettyStyle(doc.style_family, t)} · ${prettyLanguage(doc.language, t)} · ${doc.target_duration_seconds}s`
            : ""}
          {data.published_visibility === "unlisted" ? (
            <span className="ml-2 rounded bg-muted/20 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-foreground/50">
              {t("pub.unlisted")}
            </span>
          ) : null}
        </p>
      </header>

      {signedUrl && latestTrack ? (
        <section className="flex flex-col gap-3">
          <PublicSongAudio
            publicId={data.public_id}
            initialUrl={signedUrl}
            durationSeconds={latestTrack.duration_seconds}
            format={latestTrack.format}
          />
          <div className="flex flex-wrap items-center gap-2">
            <LikeButton
              songId={data.id}
              publicId={data.public_id}
              initialLiked={initiallyLiked}
              initialCount={likeCount}
              signedIn={!!currentUserId}
            />
            <VariationButton
              songId={data.id}
              styleFamily={doc?.style_family ?? "western"}
              sections={doc?.sections?.map((s) => ({
                id: s.id,
                type: s.type,
              }))}
              variant="subtle"
              initialTempo={doc?.tempo_bpm}
              initialKey={
                typeof doc?.metadata?.key === "string"
                  ? doc.metadata.key
                  : undefined
              }
              initialVoiceId={doc?.voice_id}
              language={doc?.language}
            />
            <RemixButton
              songId={data.id}
              styleFamily={doc?.style_family ?? "western"}
              sections={doc?.sections?.map((s) => ({
                id: s.id,
                type: s.type,
              }))}
              variant="subtle"
              initialTempo={doc?.tempo_bpm}
              initialKey={
                typeof doc?.metadata?.key === "string"
                  ? doc.metadata.key
                  : undefined
              }
              initialVoiceId={doc?.voice_id}
              language={doc?.language}
            />
          </div>
        </section>
      ) : (
        // v1.4 live-bug closeout: the previous copy said "Audio is still
        // being prepared. Refresh in a moment." for any song without a
        // track, including seeded catalog rows that will never get one.
        // Branch by status so the message is honest.
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          {data.status === "queued" || data.status === "processing"
            ? t("pub.rendering")
            : t("pub.noPreview")}
        </p>
      )}

      {doc ? <SongMetadata doc={doc} t={t} /> : null}

      {doc ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-foreground/50">
            {t("song.sections")}
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
        <span>{t("pub.footer.ai")} · <Link href="/trust" className="underline hover:text-foreground/70">{t("pub.footer.safe")}</Link></span>
        <ReportButton publicId={params.publicId} />
        <Link href="/" className="hover:text-foreground/70">
          {t("pub.makeYourOwn")}
        </Link>
      </footer>
          <ProCta />
    </main>
  );
}

type TFn = ReturnType<typeof serverI18n>["t"];

function SongMetadata({ doc, t }: { doc: SongDocumentView; t: TFn }) {
  const rows: { label: string; value: string }[] = [];
  if (doc.tempo_bpm) rows.push({ label: t("pub.meta.tempo"), value: `${doc.tempo_bpm} BPM` });
  if (doc.time_signature)
    rows.push({ label: t("pub.meta.timeSig"), value: doc.time_signature });
  if (doc.tala) rows.push({ label: t("pub.meta.tala"), value: doc.tala });
  if (doc.raga) {
    rows.push({
      label: t("pub.meta.raga"),
      value: `${doc.raga.name} (${doc.raga.system})`,
    });
    if (doc.raga.arohana?.length)
      rows.push({ label: t("pub.meta.arohana"), value: doc.raga.arohana.join(" ") });
    if (doc.raga.avarohana?.length)
      rows.push({ label: t("pub.meta.avarohana"), value: doc.raga.avarohana.join(" ") });
  }
  if (doc.orchestration) {
    if (doc.orchestration.lead_vocal)
      rows.push({ label: t("pub.meta.leadVocal"), value: doc.orchestration.lead_vocal });
    if (doc.orchestration.instruments?.length)
      rows.push({
        label: t("pub.meta.instruments"),
        value: doc.orchestration.instruments.join(", "),
      });
    if (doc.orchestration.texture)
      rows.push({ label: t("pub.meta.texture"), value: doc.orchestration.texture });
  }
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        {t("song.composition")}
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

function prettyStyle(s: string, t: TFn): string {
  if (s === "western") return t("pub.style.western");
  if (s === "carnatic") return t("pub.style.carnatic");
  if (s === "hindustani") return t("pub.style.hindustani");
  if (s === "kannada-folk") return t("pub.style.kannadaFolk");
  return s;
}

function prettyLanguage(l: string, t: TFn): string {
  if (l === "en") return t("pub.lang.en");
  if (l === "hi") return t("pub.lang.hi");
  if (l === "kn") return t("pub.lang.kn");
  return l;
}

function prettySectionType(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ");
}
