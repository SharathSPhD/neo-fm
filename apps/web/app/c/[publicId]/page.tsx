/**
 * /c/[publicId] -- public collection page. Anonymous-readable only when the
 * collection is public or unlisted; private and unknown ids 404. Songs are
 * limited to ones that are themselves published, so a shared playlist can
 * never expose a private song.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicCollectionPlayer } from "@/components/collections/public-collection-player";
import { loadPublicCollection } from "@/lib/collections/load";
import { PublicIdSchema } from "@/lib/collections/schema";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { publicId: string };
}): Promise<Metadata> {
  const check = PublicIdSchema.safeParse(params.publicId);
  const found = check.success ? await loadPublicCollection(check.data).catch(() => null) : null;
  if (!found) return { title: "neo-fm" };
  const { collection, songs } = found;
  const description =
    collection.description?.trim() ||
    `${songs.length} ${songs.length === 1 ? "song" : "songs"} on neo-fm.`;
  return {
    title: collection.title,
    description,
    robots:
      collection.visibility === "public"
        ? { index: true, follow: true }
        : { index: false, follow: false },
    openGraph: { title: collection.title, description, type: "website" },
    twitter: { card: "summary_large_image", title: collection.title, description },
  };
}

export default async function PublicCollectionPage({ params }: { params: { publicId: string } }) {
  const check = PublicIdSchema.safeParse(params.publicId);
  if (!check.success) notFound();
  const found = await loadPublicCollection(check.data);
  if (!found) notFound();
  const { collection, songs } = found;
  const playable = songs.flatMap((s) =>
    s.publicId
      ? [{ publicId: s.publicId, title: s.title, subtitle: [s.language, s.style].filter(Boolean).join(" · ") }]
      : [],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.3em] text-foreground/50">neo-fm · playlist</p>
        <h1 className="text-4xl font-medium tracking-tight">{collection.title}</h1>
        {collection.description ? (
          <p className="text-foreground/75">{collection.description}</p>
        ) : null}
        <p className="text-sm text-foreground/55">
          {playable.length} {playable.length === 1 ? "song" : "songs"}
        </p>
      </header>
      <PublicCollectionPlayer songs={playable} />
      <footer className="text-sm text-foreground/60">
        <Link href="/" className="text-accent underline underline-offset-4">
          Make your own songs on neo-fm
        </Link>
      </footer>
    </main>
  );
}
