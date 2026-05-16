import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { createServerClient } from "@/lib/supabase/server";

import { CreationCanvas } from "./creation-canvas";

export default async function NewSongPage() {
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect("/sign-in?next=/songs/new");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Breadcrumbs
        items={[{ href: "/library", label: "Library" }, { label: "New song" }]}
      />
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">New song</h1>
        <p className="text-sm text-foreground/60">
          Describe the song you want. We&apos;ll route it to the DGX and stream
          status updates back here.
        </p>
      </header>
      <CreationCanvas />
    </div>
  );
}
