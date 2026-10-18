import type { Metadata } from "next";

import { serverI18n } from "@/lib/i18n/server";
import { createServerClient } from "@/lib/supabase/server";

import { StationPlayer } from "./station-player";

export const metadata: Metadata = { title: "Station" };
export const dynamic = "force-dynamic";

export default async function StationPage() {
  const { data } = await createServerClient().auth.getUser();
  const anonymous = !data?.user;
  const { t } = await serverI18n();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("station.title")}</h1>
      <p className="text-sm text-foreground/70">
        {anonymous
          ? t("station.intro.anon")
          : t("station.intro.user")}
      </p>
      <StationPlayer anonymous={anonymous} />
    </main>
  );
}
