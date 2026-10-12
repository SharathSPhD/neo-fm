/** /collections/[id] -- owner view: play all, edit, remove songs, share. */
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { loadOwnedCollection } from "@/lib/collections/load";
import { createServerClient } from "@/lib/supabase/server";

import { CollectionManager } from "./collection-manager";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CollectionPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const { data: auth } = await createServerClient().auth.getUser();
  if (!auth.user) redirect(`/sign-in?next=/collections/${params.id}`);
  const found = await loadOwnedCollection(auth.user.id, params.id);
  if (!found) notFound();
  const { collection, songs } = found;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ href: "/collections", label: "Collections" }, { label: collection.title }]}
      />
      <CollectionManager
        collection={{
          id: collection.id,
          title: collection.title,
          description: collection.description,
          visibility: collection.visibility,
          publicId: collection.public_id,
        }}
        songs={songs}
      />
    </div>
  );
}
