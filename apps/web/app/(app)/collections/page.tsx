/** /collections -- the signed-in user's playlists. */
import Link from "next/link";
import { redirect } from "next/navigation";

import { collectionsDb, COLLECTION_COLUMNS, type CollectionRow } from "@/lib/collections/load";
import { createServerClient } from "@/lib/supabase/server";

import { CreateCollectionForm } from "./create-form";

export const dynamic = "force-dynamic";

const VIS_LABEL = { private: "Private", unlisted: "Link only", public: "Public" } as const;

export default async function CollectionsPage() {
  const { data: auth } = await createServerClient().auth.getUser();
  if (!auth.user) redirect("/sign-in?next=/collections");

  const { data } = await collectionsDb()
    .from("collections")
    .select(`${COLLECTION_COLUMNS}, collection_items ( job_id )`)
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false })
    .limit(50)
    .returns<(CollectionRow & { collection_items: { job_id: string }[] })[]>();
  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Collections</h1>
        <p className="text-sm text-foreground/60">
          Playlists of your songs and others&apos; public songs. Share one with a link.
        </p>
      </header>
      <CreateCollectionForm />
      {rows.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No collections yet. Create one above, or use &quot;Add to collection&quot; on any song.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/collections/${c.id}`}
                className="flex min-h-11 flex-col gap-1 rounded-xl border border-muted/40 p-4 hover:border-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="truncate text-lg font-medium">{c.title}</span>
                <span className="text-xs text-foreground/60">
                  {c.collection_items.length} {c.collection_items.length === 1 ? "song" : "songs"} ·{" "}
                  {VIS_LABEL[c.visibility]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
