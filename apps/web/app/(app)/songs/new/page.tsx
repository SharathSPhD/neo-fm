import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ideaById } from "@/lib/ideas/catalog";
import { createServerClient } from "@/lib/supabase/server";

import { CreationCanvas } from "./creation-canvas";

export default async function NewSongPage({ searchParams }: { searchParams?: { idea?: string } }) {
  // `?idea=<id>` comes from the /ideas gallery. Only known catalog ids are honoured; the prompt text never travels in the URL.
  const idea = ideaById(searchParams?.idea);
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect(idea ? `/sign-in?next=${encodeURIComponent(`/songs/new?idea=${idea.id}`)}` : "/sign-in?next=/songs/new");

  // First-run guide shows until the user has at least one song. A failed
  // count must not hide the form, so errors fall back to "show the guide".
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  const firstRun = (count ?? 0) === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Breadcrumbs
        items={[{ href: "/library", label: "Library" }, { label: "New song" }]}
      />
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">New song</h1>
        <p className="text-sm text-foreground/60">
          Describe the song you want. We&apos;ll render it on our engine
          and stream status updates back here.
        </p>
      </header>
      <CreationCanvas firstRun={firstRun} initialIdea={idea ? { prompt: idea.text, language: idea.lang } : undefined} />
    </div>
  );
}
