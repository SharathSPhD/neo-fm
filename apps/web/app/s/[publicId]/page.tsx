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
import { ReportButton } from "@/components/report-button";
import { serverI18n } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/ui-strings";
import { FunnelBeacon } from "@/components/funnel-beacon";
import { MoreLikeThis } from "@/components/more-like-this";
import { loadDedication } from "@/lib/share/load";
import { whatsappShareUrl } from "@/lib/station/share";
import { jsonLdString, musicRecordingLd } from "@/lib/seo/jsonld";
import { siteUrl } from "@/lib/seo/site";
import { prettyStyle as styleLabel } from "@/lib/song/labels";
import { ProCta } from "@/components/pro-cta";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";

import { requestOrigin } from "@/lib/embed/origin";

import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import { AddToCollectionButton } from "@/components/collections/add-to-collection";
import { LikeButton } from "@/components/like-button";
import { PublicShareButton } from "@/components/public-share-button";
import { RemixButton } from "@/app/(app)/songs/[id]/remix-button";
import { VariationButton } from "@/app/(app)/songs/[id]/variation-button";

import { LanguageSwitcher } from "@/components/language-versions/language-switcher";
import { MakeInLanguageButton } from "@/components/language-versions/make-in-language";
import { loadVersionSiblings } from "@/lib/song/language-versions-load";

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

export async function generateMetadata(
  props: {
    params: Promise<{ publicId: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
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
  const dedication = await loadDedication(idCheck.data);
  // A dedication names a person: never index it, even on a public song.
  const robots =
    data.published_visibility === "unlisted" || dedication
      ? { index: false, follow: false }
      : { index: true, follow: true };
  // oEmbed discovery (https://oembed.com/#section4): lets Notion, Substack,
  // WordPress etc. turn a pasted link into the embedded player.
  const origin = await requestOrigin();
  const oembed = origin
    ? `${origin}/api/oembed?url=${encodeURIComponent(`${origin}/s/${data.public_id}`)}`
    : null;
  return {
    title: dedication ? `A song for ${dedication.to}` : title,
    description: dedication?.message
      ? dedication.message.slice(0, 160)
      : description,
    robots,
    alternates: {
      canonical: `/s/${idCheck.data}`,
      ...(oembed ? { types: { "application/json+oembed": oembed } } : {}),
    },
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

export default async function PublicSongPage(
  props: {
    params: Promise<{ publicId: string }>;
  }
) {
  const params = await props.params;
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) notFound();

  const data = await loadPublicSong(idCheck.data);
  if (!data) notFound();
  const { t } = await serverI18n();
  const doc = data.song_documents?.document_json;
  const storedTitle = data.song_documents?.title?.trim();
  const displayTitle =
    storedTitle && storedTitle.length > 0
      ? storedTitle
      : doc
        ? prettyStyle(doc.style_family, t)
        : t("song.song");

  const dedication = await loadDedication(idCheck.data);

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

  const versionSiblings = await loadVersionSiblings(supabase, data.id, {
    publishedOnly: true,
    viewerId: currentUserId,
  });
  // Structured data only where the page is indexable: public and not dedicated (a dedication names a person).
  const recordingLd =
    doc && data.published_visibility === "public" && !dedication
      ? musicRecordingLd({
          base: siteUrl(),
          publicId: data.public_id,
          name: displayTitle,
          language: doc.language,
          genre: styleLabel(doc.style_family),
          durationSeconds: latestTrack?.duration_seconds ?? doc.target_duration_seconds,
          datePublished: data.published_at,
          lyrics: doc.sections
            .map((sec) => sec.lyrics?.trim())
            .filter(Boolean)
            .join("\n\n"),
          hasAudio: Boolean(latestTrack && data.status === "completed"),
        })
      : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      {recordingLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(recordingLd) }} />
      ) : null}
      <FunnelBeacon event="share_view" />
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
          <span className="mr-2 rounded border border-foreground/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{t("station.aiLabel")}</span>
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
      <LanguageSwitcher currentId={data.id} siblings={versionSiblings} />

      {dedication ? (
        <section
          aria-label={t("ded.pageLabel")}
          className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-5"
        >
          <p className="text-[11px] uppercase tracking-widest text-accent/80">
            {t("ded.pageEyebrow")}
          </p>
          <p className="text-2xl font-medium tracking-tight">{dedication.to}</p>
          {dedication.message ? (
            <p className="whitespace-pre-line text-base text-foreground/80">
              {dedication.message}
            </p>
          ) : null}
        </section>
      ) : null}

      {signedUrl && latestTrack ? (
        <section className="flex flex-col gap-3">
          <PublicSongAudio
            publicId={data.public_id}
            initialUrl={signedUrl}
            durationSeconds={latestTrack.duration_seconds}
            format={latestTrack.format}
            feedbackSongId={currentUserId ? data.id : undefined}
          />
          {/* Sharing is the growth loop, so the WhatsApp send is a full-width primary action, not a small icon. */}
          <a
            href={whatsappShareUrl(
              dedication ? `A song for ${dedication.to}` : displayTitle,
              `${siteUrl()}/s/${data.public_id}`,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-black hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Send on WhatsApp
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <LikeButton
              songId={data.id}
              publicId={data.public_id}
              initialLiked={initiallyLiked}
              initialCount={likeCount}
              signedIn={!!currentUserId}
            />
            {data.status === "completed" && data.song_documents ? (
              <MakeInLanguageButton
                songId={data.id}
                title={displayTitle}
                sourceLanguage={data.song_documents.language}
                sourceStyle={data.song_documents.style_family}
                durationSeconds={
                  ([30, 60, 90, 180].includes(doc?.target_duration_seconds ?? 0)
                    ? doc?.target_duration_seconds
                    : 60) as 30 | 60 | 90 | 180
                }
                existingLanguages={versionSiblings.map((v) => v.language)}
                signedIn={!!currentUserId}
                nextPath={`/s/${data.public_id}`}
              />
            ) : null}
            <AddToCollectionButton
              jobId={data.id}
              signedIn={!!currentUserId}
              nextPath={`/s/${data.public_id}`}
            />
            <PublicShareButton
              title={displayTitle}
              feedbackSongId={currentUserId ? data.id : undefined}
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
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-warn">
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
                    lang={doc?.language}
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

      {doc ? (
        <MoreLikeThis
          publicId={data.public_id}
          language={doc.language}
          style={doc.style_family}
        />
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

type TFn = Awaited<ReturnType<typeof serverI18n>>["t"];

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
