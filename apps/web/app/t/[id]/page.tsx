/**
 * /t/[id] -- public page for one station pool track. Anonymous-readable; only admitted pool tracks resolve.
 * Carries the OG tags so a WhatsApp or Reels share shows the title and card, and a plain audio player.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportButton } from "@/components/report-button";
import { loadPoolTrack } from "@/lib/station/pool";
import { tagShareUrl } from "@/lib/share/tag";
import { isTrackId, trackShareUrl, whatsappShareUrl } from "@/lib/station/share";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const track = isTrackId(id) ? await loadPoolTrack(id) : null;
  if (!track) return { title: "neo-fm", robots: { index: false } };
  const description = "An AI-made song from neo-fm, your personal FM station.";
  return {
    title: track.title,
    description,
    // Pool tracks are not indexed during the soft launch; links still preview in chat apps.
    robots: { index: false },
    openGraph: { title: track.title, description, type: "music.song", url: trackShareUrl(id) },
    twitter: { card: "summary_large_image", title: track.title, description },
  };
}

export default async function TrackSharePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const track = isTrackId(id) ? await loadPoolTrack(id) : null;
  if (!track) notFound();

  const { data } = await createServiceRoleClient()
    .storage.from("tracks")
    .createSignedUrl(track.audioPath.replace(/^tracks\//, ""), SIGNED_URL_TTL_SECONDS);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{track.title}</h1>
      <p className="text-sm text-foreground/70">AI-made music on neo-fm</p>
      {data?.signedUrl ? (
        <audio controls preload="metadata" src={data.signedUrl} className="w-full" />
      ) : (
        <p>This song is not available right now.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href="/station" className="rounded bg-accent px-4 py-2 text-background">
          Tune in to your station
        </Link>
        <a
          href={whatsappShareUrl(track.title, tagShareUrl(trackShareUrl(id), { source: "whatsapp", campaign: "station" }))}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border px-4 py-2"
        >
          Share on WhatsApp
        </a>
      </div>
      <ReportButton trackId={id} />
    </main>
  );
}
