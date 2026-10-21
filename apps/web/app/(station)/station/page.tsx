import type { Metadata } from "next";

import { serverI18n } from "@/lib/i18n/server";
import { englishMainEnabled } from "@/lib/languages/english-main";
import { betaLanguages, minPool, stationChipLanguages } from "@/lib/languages/registry";
import { admittedLanguageCounts } from "@/lib/station/pool";
import { cleanDedicatee, dedicateEnabled } from "@/lib/station/dedicate";
import { passMixEnabled } from "@/lib/station/lang-mix";
import { findStation } from "@/lib/station/named";
import { hasPassPerks } from "@/lib/station/pass-perks";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

import { StationPlayer } from "./station-player";

const TITLE = "Your personal 24/7 FM station";
const DESCRIPTION = "Music tuned to your taste that never stops. Hindi, Tamil, Telugu, Kannada and Bengali first. All music is AI-generated.";

// The default card comes from opengraph-image.tsx next to this file; a named station points at its own card.
export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ s?: string }> }): Promise<Metadata> {
  const station = findStation((await searchParams)?.s);
  if (!station) {
    return {
      title: "neo-fm Station, your 24/7 personal FM",
      description: DESCRIPTION,
      alternates: { canonical: "/station" },
      openGraph: { title: TITLE, description: DESCRIPTION, type: "website", url: "/station" },
      twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
    };
  }
  const title = `${station.name} on neo-fm Station`;
  const description = `${station.tagline} Music tuned to your taste. All music is AI-generated.`;
  const image = { url: `/station/og/${station.slug}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    alternates: { canonical: `/station?s=${station.slug}` },
    openGraph: { title, description, type: "website", url: `/station?s=${station.slug}`, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
export const dynamic = "force-dynamic";

export default async function StationPage({ searchParams }: { searchParams?: Promise<{ s?: string; for?: string }> }) {
  // `/station?s=subah` opens a named station; anything unknown opens the listener's own station.
  const params = await searchParams;
  const initialStation = findStation(params?.s)?.slug ?? "";
  // `?for=Name` (STATION_DEDICATE=1) greets the listener with "This hour is for Name".
  const dedicate = dedicateEnabled();
  const dedicatedTo = dedicate ? cleanDedicatee(params?.for) : null;
  const { data } = await createServerClient().auth.getUser();
  const anonymous = !data?.user;
  // Station pass language mix (STATION_PASS_MIX): the picker for pass holders and Creator/Pro, a pass link for everyone else, nothing while the flag is off.
  const mixState: "off" | "locked" | "on" = !passMixEnabled()
    ? "off"
    : data?.user && (await hasPassPerks(createServiceRoleClient(), data.user.id)) ? "on" : "locked";
  const { t } = await serverI18n();
  // Empty unless LANG_WAVES or ENGLISH_MAIN is set, so the default page needs no pool read. English gets a chip once its pool is deep enough.
  const englishMain = englishMainEnabled();
  const counts = process.env.LANG_WAVES || englishMain ? await admittedLanguageCounts() : {};
  const extraLangs = [
    ...(process.env.LANG_WAVES ? stationChipLanguages(process.env.LANG_WAVES, process.env.LANG_MIN_POOL, counts).map((l) => l.code as string) : []),
    ...(englishMain && (counts.en ?? 0) >= minPool(process.env.LANG_MIN_POOL) ? ["en"] : []),
  ];
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("station.title")}</h1>
      <p className="text-sm text-foreground/70">
        {anonymous
          ? t("station.intro.anon")
          : t("station.intro.user")}
      </p>
      <StationPlayer mixState={mixState} anonymous={anonymous} extraLangs={extraLangs} betaLangs={betaLanguages(extraLangs, process.env.LANG_REVIEWED)} initialStation={initialStation} dedicate={dedicate} dedicatedTo={dedicatedTo} />
    </main>
  );
}
