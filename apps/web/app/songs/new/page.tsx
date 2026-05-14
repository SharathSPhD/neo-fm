import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

import { CreationCanvas } from "./creation-canvas";

export default async function NewSongPage() {
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect("/sign-in?next=/songs/new");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-medium tracking-tight">New song</h1>
          <p className="text-sm text-foreground/60">
            Describe the song you want. We&apos;ll route it to the DGX and stream
            status updates back here.
          </p>
        </div>
        <Link
          href="/library"
          className="text-sm text-foreground/60 underline hover:text-foreground"
        >
          ← Library
        </Link>
      </header>
      <CreationCanvas />
    </main>
  );
}
