import type { Metadata } from "next";

import { serverI18n } from "@/lib/i18n/server";
import { createServerClient } from "@/lib/supabase/server";

import { StationPlayer } from "./station-player";

const TITLE = "Your personal 24/7 FM station";
const DESCRIPTION = "Music tuned to your taste that never stops. Hindi, Tamil, Telugu, Kannada and Bengali first. All music is AI-generated.";

// The card image comes from opengraph-image.tsx next to this file.
export const metadata: Metadata = {
  title: "Station",
  description: DESCRIPTION,
  alternates: { canonical: "/station" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", url: "/station" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};
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
