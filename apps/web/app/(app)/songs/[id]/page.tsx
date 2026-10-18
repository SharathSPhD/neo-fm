/**
 * /songs/[id] -- song detail page (M4).
 *
 * Server component. Fetches the job + song document + signed-URL via
 * `GET /api/songs/[id]` (same RLS-gated path the library uses). Renders:
 *
 *   - the Song Document headline (style, language, length, raga/tala
 *     if present, orchestration)
 *   - per-section breakdown with lyrics and a "Regenerate" button (M5)
 *   - the `<audio>` player with ADR 0012 Tier-1 signed URL embedded,
 *     and the `<SongAudio>` client component handling Tier-2 refresh
 *
 * Authentication: redirects to /sign-in if no session. Returns 404 page
 * for songs the user doesn't own (RLS hides them transparently from
 * the maybeSingle query).
 */
import { notFound, redirect } from "next/navigation";

import { occasionById } from "@/lib/gift/occasions";
import { serverI18n } from "@/lib/i18n/server";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { JobProgress } from "@/components/job-progress";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createServerClient } from "@/lib/supabase/server";

import { RecoverButton } from "../../library/recover-button";
import { RegenerateButton } from "./regenerate-button";
import { RemixButton } from "./remix-button";
import { LanguageSwitcher } from "@/components/language-versions/language-switcher";
import { MakeInLanguageButton } from "@/components/language-versions/make-in-language";
import { loadVersionSiblings } from "@/lib/song/language-versions-load";
import { AddToCollectionButton } from "@/components/collections/add-to-collection";
import { ShareButton } from "./share-button";
import { SongAudio } from "./song-audio";
import { DictionCheck } from "./diction-check";
import { StemsPanel } from "./stems-panel";
import { KaraokeTicker } from "./karaoke-ticker";
import { LyricsMeaning } from "./lyrics-meaning";
import { VariationButton } from "./variation-button";
import { CoverArtPanel } from "./cover-art-panel";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h, ADR 0012 Tier 1.

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
  pakad?: string;
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
  // v1.4: top-level voice_id (per Section can override). Read in the
  // variation/remix dialog so dropdowns seed from the parent doc.
  voice_id?: string;
  // metadata.key carries the Western chord key (e.g. "F#m"). Used to
  // seed the fork dialog's Key placeholder.
  metadata?: { key?: string } & Record<string, unknown>;
}

interface RegenChildView {
  id: string;
  status: string;
  error: string | null;
  section_id: string | null;
  created_at: string;
}

export default async function SongDetailPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams?: Promise<{ occasion?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const { t, lang } = await serverI18n();
  const supabase = createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/songs/${params.id}`)}`);
  }

  // Same query shape as /api/songs/[id], but called inline to skip the
  // round-trip and so we get back the SongDocument fields untouched.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      error,
      created_at,
      finished_at,
      song_document_id,
      public_id,
      published_visibility,
      remixed_from,
      song_documents (
        id, language, style_family, document_json, title, created_at
      ),
      tracks (
        id, url, duration_seconds, format, bytes, created_at
      )
    `,
    )
    .eq("id", params.id)
    .order("created_at", { referencedTable: "tracks", ascending: false })
    .maybeSingle<{
      id: string;
      status: string;
      error: string | null;
      created_at: string;
      finished_at: string | null;
      song_document_id: string;
      public_id: string | null;
      published_visibility: "public" | "unlisted" | "private";
      remixed_from: string | null;
      song_documents: {
        id: string;
        language: string;
        style_family: string;
        document_json: SongDocumentView;
        title: string | null;
        created_at: string;
      } | null;
      tracks:
        | {
            id: string;
            url: string;
            duration_seconds: number | null;
            format: string;
            bytes: number | null;
            created_at: string;
          }[]
        | null;
    }>();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {t("song.loadError")} {error.message}
        </p>
      </div>
    );
  }
  if (!data) {
    notFound();
  }

  // Sibling regen jobs (M5): everything with this song as parent_job_id.
  const { data: regenChildrenRaw } = await supabase
    .from("jobs")
    .select("id, status, error, section_id, created_at")
    .eq("parent_job_id", params.id)
    .order("created_at", { ascending: false })
    .returns<RegenChildView[]>();
  const regenChildren = regenChildrenRaw ?? [];

  // If this song is itself a remix, fetch the parent's title for the
  // "Remixed from …" backlink. RLS may hide it (parent went private),
  // in which case we render "a deleted/private song" instead.
  let remixedFromInfo: { id: string; title: string | null } | null = null;
  if (data.remixed_from) {
    const { data: parent } = await supabase
      .from("jobs")
      .select("id, song_documents ( title )")
      .eq("id", data.remixed_from)
      .maybeSingle<{
        id: string;
        song_documents: { title: string | null } | null;
      }>();
    if (parent) {
      remixedFromInfo = {
        id: parent.id,
        title: parent.song_documents?.title ?? null,
      };
    } else {
      remixedFromInfo = { id: data.remixed_from, title: null };
    }
  }

  // Own query, tolerant of a missing column (deploy before migration 0074).
  const dedicationRow = await (
    supabase.from("jobs") as unknown as {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          maybeSingle: () => Promise<{
            data: { dedication_to: string | null; dedication_message: string | null } | null;
          }>;
        };
      };
    }
  )
    .select("dedication_to, dedication_message")
    .eq("id", data.id)
    .maybeSingle()
    .then((r) => r.data)
    .catch(() => null);

  const doc = data.song_documents?.document_json;
  const title =
    data.song_documents?.title ??
    (doc ? prettyStyle(doc.style_family) : t("song.song"));
  const tracks = (data.tracks ?? [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const latestTrack = tracks[0];

  let signedUrl: string | null = null;
  if (latestTrack && data.status === "completed") {
    const objectPath = latestTrack.url.replace(/^tracks\//, "");
    const { data: signed } = await supabase.storage
      .from("tracks")
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    signedUrl = signed?.signedUrl ?? null;
  }

  // Advisory pronunciation audit (agent_runs has no RLS policies; ownership of the job was already proven above).
  let dictionQa: { matchPct?: number; flagged?: { line: string; heard: string; cer: number }[] } | null = null;
  if (data.status === "completed") {
    try {
      const { data: runs } = await createServiceRoleClient().from("agent_runs" as never).select("diction_qa").eq("job_id" as never, data.id as never).limit(1);
      dictionQa = ((runs ?? []) as { diction_qa: typeof dictionQa }[])[0]?.diction_qa ?? null;
    } catch { /* optional */ }
  }

  const versionSiblings = await loadVersionSiblings(supabase, data.id, {
    viewerId: userData.user.id,
  });
  const originalBrief =
    typeof doc?.metadata?.prompt === "string" ? doc.metadata.prompt : null;
  // Heard per-line lyric times (separate query: the column may not exist yet
  // on older databases, and that must not take the diction audit down too).
  let lineTimings: unknown = null;
  if (data.status === "completed") {
    try {
      const { data: runs } = await createServiceRoleClient().from("agent_runs" as never).select("line_timings").eq("job_id" as never, data.id as never).limit(1);
      lineTimings = ((runs ?? []) as { line_timings: unknown }[])[0]?.line_timings ?? null;
    } catch { /* optional */ }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Breadcrumbs
        items={[
          { href: "/library", label: t("nav.library") },
          { label: title },
        ]}
      />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
          <p className="text-sm text-foreground/60">
            {doc
              ? `${prettyStyle(doc.style_family)} · ${prettyLanguage(doc.language)} · ${doc.target_duration_seconds}s · ${data.status}`
              : data.status}
          </p>
          {remixedFromInfo ? (
            <p className="text-xs text-foreground/55">
              {t("song.remixedFrom")}{" "}
              {remixedFromInfo.title ? (
                <Link
                  href={`/songs/${remixedFromInfo.id}`}
                  className="text-accent underline underline-offset-4"
                >
                  {remixedFromInfo.title}
                </Link>
              ) : (
                <span className="italic text-foreground/45">
                  {t("song.privateOrDeleted")}
                </span>
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ShareButton
            songId={data.id}
            initialVisibility={data.published_visibility}
            initialPublicId={data.public_id}
            title={title}
            initialDedication={{
              to: dedicationRow?.dedication_to ?? "",
              message: dedicationRow?.dedication_message ?? "",
            }}
            canShare={data.status === "completed"}
            occasion={occasionById(searchParams?.occasion)?.label[lang] ?? null}
            clipSource={
              signedUrl && (doc as SongDocumentView | null | undefined)?.sections?.length
                ? {
                    audioUrl: signedUrl,
                    sections: (doc as SongDocumentView).sections,
                    durationSeconds: latestTrack?.duration_seconds ?? null,
                    lineTimings,
                  }
                : undefined
            }
          />
          {data.status === "completed" && doc && data.song_documents ? (
            <MakeInLanguageButton
              songId={data.id}
              title={title}
              sourceLanguage={data.song_documents.language}
              sourceStyle={data.song_documents.style_family}
              durationSeconds={doc.target_duration_seconds as 30 | 60 | 90 | 180}
              originalBrief={originalBrief}
              existingLanguages={versionSiblings.map((v) => v.language)}
            />
          ) : null}
          {data.status === "completed" ? <AddToCollectionButton jobId={data.id} /> : null}
          {data.status === "completed" ? (
            <div className="flex flex-col items-end gap-2">
              <VariationButton
                songId={data.id}
                styleFamily={doc?.style_family ?? "western"}
                sections={doc?.sections?.map((s) => ({
                  id: s.id,
                  type: s.type,
                }))}
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
          ) : null}
          <code className="font-mono text-[11px] text-foreground/50">
            {data.id.slice(0, 8)}
          </code>
          {data.finished_at ? (
            <span className="text-[10px] text-foreground/40">
              {t("song.finished")} {new Date(data.finished_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      </header>
      <LanguageSwitcher currentId={data.id} siblings={versionSiblings} />

      {data.error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {t("song.failed")}: {data.error}
        </p>
      ) : null}

      {signedUrl ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-foreground/50">
            {t("song.playback")}
          </h2>
          <SongAudio
            songId={data.id}
            initialUrl={signedUrl}
            durationSeconds={latestTrack?.duration_seconds ?? null}
            format={latestTrack?.format ?? "wav"}
            title={title}
            subtitle={doc ? `${prettyStyle(doc.style_family)} · ${prettyLanguage(doc.language)}` : undefined}
          />
          {data.song_documents?.document_json &&
          (data.song_documents.document_json as SongDocumentView)?.sections
            ?.length ? (
            <KaraokeTicker
              sections={
                (data.song_documents.document_json as SongDocumentView).sections
              }
              durationSeconds={latestTrack?.duration_seconds ?? null}
              lineTimings={lineTimings}
            />
          ) : null}
          {data.song_documents?.document_json &&
          (data.song_documents.document_json as SongDocumentView)?.sections
            ?.length ? (
            <LyricsMeaning songId={data.id} />
          ) : null}
          <StemsPanel songId={data.id} />
        </section>
      ) : data.status === "completed" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <span>
            {t("song.orphan")}
          </span>
          <RecoverButton songId={data.id} label={t("song.recover")} />
        </div>
      ) : data.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          <span>{t("song.failed")}{data.error ? `: ${data.error}` : "."}</span>
          <RecoverButton songId={data.id} label={t("song.retry")} />
        </div>
      ) : (
        <JobProgress songId={data.id} createdAt={data.created_at} initialStage={data.status === "processing" ? "starting" : "queued"} />
      )}

      <DictionCheck qa={dictionQa} />

      {data.status === "completed" ? (
        <CoverArtPanel songId={data.id} />
      ) : null}

      {doc ? (
        <>
          <SongMetadata doc={doc} />
          <SectionsView
            songId={data.id}
            doc={doc}
            regenChildren={regenChildren}
            canRegen={data.status === "completed"}
          />
        </>
      ) : null}

      {regenChildren.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-widest text-foreground/50">
            {t("song.regenHistory")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {regenChildren.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-muted/20 bg-muted/5 px-3 py-2 text-xs"
              >
                <span className="font-mono text-foreground/60">
                  {c.id.slice(0, 8)}
                </span>
                <span className="text-foreground/50">
                  {c.section_id ? `section ${c.section_id}` : "(unknown section)"}
                </span>
                <span
                  className={
                    c.status === "completed"
                      ? "text-emerald-300"
                      : c.status === "failed"
                        ? "text-red-300"
                        : "text-accent"
                  }
                >
                  {c.status}
                </span>
                <span className="text-foreground/40">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

async function SongMetadata({ doc }: { doc: SongDocumentView }) {
  const { t } = await serverI18n();
  const rows: { label: string; value: string }[] = [];
  if (doc.tempo_bpm) rows.push({ label: t("songmeta.tempo"), value: `${doc.tempo_bpm} BPM` });
  if (doc.time_signature)
    rows.push({ label: t("songmeta.timeSig"), value: doc.time_signature });
  if (doc.tala) rows.push({ label: t("songmeta.tala"), value: doc.tala });
  if (doc.raga) {
    rows.push({
      label: t("songmeta.raga"),
      value: `${doc.raga.name} (${doc.raga.system})`,
    });
    if (doc.raga.arohana?.length)
      rows.push({ label: t("songmeta.arohana"), value: doc.raga.arohana.join(" ") });
    if (doc.raga.avarohana?.length)
      rows.push({ label: t("songmeta.avarohana"), value: doc.raga.avarohana.join(" ") });
  }
  if (doc.orchestration) {
    if (doc.orchestration.lead_vocal)
      rows.push({ label: t("songmeta.leadVocal"), value: doc.orchestration.lead_vocal });
    if (doc.orchestration.instruments?.length)
      rows.push({
        label: t("songmeta.instruments"),
        value: doc.orchestration.instruments.join(", "),
      });
    if (doc.orchestration.texture)
      rows.push({ label: t("songmeta.texture"), value: doc.orchestration.texture });
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

async function SectionsView({
  songId,
  doc,
  regenChildren,
  canRegen,
}: {
  songId: string;
  doc: SongDocumentView;
  regenChildren: RegenChildView[];
  canRegen: boolean;
}) {
  const { t: tr } = await serverI18n();
  const inFlightSections = new Set(
    regenChildren
      .filter((c) => c.status === "queued" || c.status === "processing")
      .map((c) => c.section_id)
      .filter((s): s is string => s !== null),
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        {tr("song.sections")}
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
                <code className="font-mono text-[10px] text-foreground/40">
                  {s.id}
                </code>
              </div>
              {canRegen ? (
                inFlightSections.has(s.id) ? (
                  <span className="text-[10px] text-accent">
                    {tr("song.regenInFlight")}
                  </span>
                ) : (
                  <RegenerateButton songId={songId} sectionId={s.id} />
                )
              ) : null}
            </div>
            {s.lyrics ? (
              <p className="whitespace-pre-line font-serif text-sm leading-relaxed text-foreground/80">
                {s.lyrics}
              </p>
            ) : (
              <p className="text-[11px] text-foreground/40">
                {tr("song.noLyrics")}
              </p>
            )}
            {s.tags && s.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {s.tags.map((t) => (
                  <li
                    key={t}
                    className="rounded-full border border-muted/20 px-2 py-0.5 text-[10px] text-foreground/50"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function prettyStyle(style: string): string {
  switch (style) {
    case "carnatic":
      return "Carnatic kriti";
    case "hindustani":
      return "Hindustani khayal";
    case "kannada-folk":
      return "Kannada folk";
    case "western":
      return "Western song";
    default:
      return style;
  }
}
function prettyLanguage(lang: string): string {
  switch (lang) {
    case "hi":
      return "Hindi";
    case "kn":
      return "Kannada";
    case "en":
      return "English";
    default:
      return lang;
  }
}
function prettySectionType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
