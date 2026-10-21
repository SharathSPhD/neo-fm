/** /station/week -- "your week on neo-fm": a private, shareable recap of the signed-in listener's last seven days. Off (404) unless STATION_WEEK=1. */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { weekEnabled } from "@/lib/station/week";
import { loadWeek } from "@/lib/station/week-load";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

import { WeekView } from "./week-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your week on neo-fm", robots: { index: false, follow: false } };

export default async function WeekPage() {
  if (!weekEnabled()) notFound();
  const { data } = await createServerClient().auth.getUser();
  if (!data?.user) redirect("/sign-in?next=/station/week");
  let week = null;
  try {
    week = await loadWeek(createServiceRoleClient() as never, data.user.id);
  } catch (e) {
    console.error("station week page failed", e instanceof Error ? e.message : e);
  }
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6">
      <WeekView week={week} />
    </main>
  );
}
