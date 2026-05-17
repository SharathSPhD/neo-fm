/**
 * /songs/[id]/compare — RLHF pairwise preference UI (v1.4 Sprint 16).
 *
 * When a job was rendered with `top_n_candidates > 1`, this page
 * presents two of the candidate tracks side-by-side and asks "which
 * sounds better?". The vote is recorded via the
 * `record_preference_pair` RPC (migration 0041).
 *
 * Auth: server-rendered, owner-only. Non-owners get a 404 by way of
 * RLS — they cannot see the candidate tracks.
 */
import { redirect, notFound } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

import { CompareForm } from "./compare-form";

export const dynamic = "force-dynamic";

type RawJob = {
  id: string;
  user_id: string;
  status: string;
  song_documents: { title: string | null; style_family: string } | null;
};

type RawTrack = {
  id: string;
  candidate_index: number;
  is_current: boolean;
  url: string;
  duration_seconds: number | null;
};

const TRACK_BUCKET_PREFIX = "tracks/";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function pickPair(tracks: RawTrack[]): [RawTrack, RawTrack] | null {
  if (tracks.length < 2) return null;
  const sorted = tracks.slice().sort((a, b) => a.candidate_index - b.candidate_index);
  const current = sorted.find((t) => t.is_current);
  if (current) {
    const other = sorted.find((t) => t.id !== current.id);
    if (other) return [current, other];
  }
  const first = sorted[0];
  const second = sorted[1];
  if (!first || !second) return null;
  return [first, second];
}

export default async function ComparePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect(`/sign-in?next=/songs/${params.id}/compare`);

  const { data: jobRow } = await supabase
    .from("jobs")
    .select(
      "id, user_id, status, song_documents!inner(title, style_family)",
    )
    .eq("id", params.id)
    .single<RawJob>();

  if (!jobRow || jobRow.user_id !== userData.user.id) notFound();

  const { data: trackRows } = await supabase
    .from("tracks")
    .select("id, candidate_index, is_current, url, duration_seconds")
    .eq("job_id", params.id)
    .returns<RawTrack[]>();

  const tracks = trackRows ?? [];
  const pair = pickPair(tracks);

  if (!pair) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-medium">Compare candidates</h1>
        <p className="rounded-md border border-dashed border-muted/30 px-4 py-6 text-sm text-foreground/65">
          This song was rendered with a single candidate. Compare mode needs
          at least two candidate tracks. Re-render with{" "}
          <code>top_n_candidates &gt; 1</code> (Sprint 16) to enable
          pairwise preference collection.
        </p>
      </main>
    );
  }

  const tracksApi = supabase.storage.from("tracks");
  const signed = await Promise.all(
    pair.map(async (t) => {
      const path = t.url.startsWith(TRACK_BUCKET_PREFIX)
        ? t.url.slice(TRACK_BUCKET_PREFIX.length)
        : t.url;
      const { data } = await tracksApi.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      return { id: t.id, url: data?.signedUrl ?? null };
    }),
  );

  const [trackA, trackB] = pair;
  const [signedA, signedB] = signed;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">
          {jobRow.song_documents?.title ?? "Compare candidates"}
        </h1>
        <p className="text-sm text-foreground/65">
          Listen to both. Pick the one that sounds better. Your vote trains
          the v1.4 reranker.
        </p>
      </header>
      <CompareForm
        jobId={jobRow.id}
        a={{ trackId: trackA.id, label: "Candidate A", url: signedA?.url ?? null }}
        b={{ trackId: trackB.id, label: "Candidate B", url: signedB?.url ?? null }}
      />
    </main>
  );
}
