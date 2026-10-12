import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { serverI18n } from "@/lib/i18n/server";
import { createServerClient } from "@/lib/supabase/server";

import { CreationCanvas } from "./creation-canvas";

export default async function NewSongPage() {
  const { t } = serverI18n();
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect("/sign-in?next=/songs/new");

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
        items={[{ href: "/library", label: t("nav.library") }, { label: t("nav.newSong") }]}
      />
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">{t("nav.newSong")}</h1>
        <p className="text-sm text-foreground/60">
          {t("create.intro")}
        </p>
      </header>
      <CreationCanvas firstRun={firstRun} />
    </div>
  );
}
