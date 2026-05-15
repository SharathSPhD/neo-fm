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
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

import { RegenerateButton } from "./regenerate-button";
import { ShareButton } from "./share-button";
import { SongAudio } from "./song-audio";

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
}

interface RegenChildView {
  id: string;
  status: string;
  error: string | null;
  section_id: string | null;
  created_at: string;
}

export default async function SongDetailPage({
  params,
}: {
  params: { id: string };
}) {
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
      song_documents (
        id, language, style_family, document_json, created_at
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
      song_documents: {
        id: string;
        language: string;
        style_family: string;
        document_json: SongDocumentView;
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
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load song: {error.message}
        </p>
      </main>
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

  const doc = data.song_documents?.document_json;
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

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href="/library"
            className="text-[11px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70"
          >
            ← Library
          </Link>
          <h1 className="text-3xl font-medium tracking-tight">
            {doc ? prettyStyle(doc.style_family) : "Song"}
          </h1>
          <p className="text-sm text-foreground/60">
            {doc
              ? `${prettyLanguage(doc.language)} · ${doc.target_duration_seconds}s · ${data.status}`
              : data.status}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ShareButton
            songId={data.id}
            initialVisibility={data.published_visibility}
            initialPublicId={data.public_id}
            canShare={data.status === "completed"}
          />
          <code className="font-mono text-[11px] text-foreground/50">
            {data.id.slice(0, 8)}
          </code>
          {data.finished_at ? (
            <span className="text-[10px] text-foreground/40">
              finished {new Date(data.finished_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      </header>

      {data.error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          Generation failed: {data.error}
        </p>
      ) : null}

      {signedUrl ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-widest text-foreground/50">
            Playback
          </h2>
          <SongAudio
            songId={data.id}
            initialUrl={signedUrl}
            durationSeconds={latestTrack?.duration_seconds ?? null}
            format={latestTrack?.format ?? "wav"}
          />
        </section>
      ) : data.status === "completed" ? (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          Song is completed but the rendered track is still being indexed.
          Refresh in a few seconds.
        </p>
      ) : (
        <p className="text-sm text-foreground/60">
          {data.status === "processing"
            ? "Generating audio…"
            : data.status === "queued"
              ? "Queued."
              : `Status: ${data.status}.`}
        </p>
      )}

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
            Regen history
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

function SectionsView({
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
  const inFlightSections = new Set(
    regenChildren
      .filter((c) => c.status === "queued" || c.status === "processing")
      .map((c) => c.section_id)
      .filter((s): s is string => s !== null),
  );
  return (
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
                <code className="font-mono text-[10px] text-foreground/40">
                  {s.id}
                </code>
              </div>
              {canRegen ? (
                inFlightSections.has(s.id) ? (
                  <span className="text-[10px] text-accent">
                    Regen in flight…
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
                No lyrics (instrumental section).
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
