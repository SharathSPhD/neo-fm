import type { Metadata } from "next";

import { createServerClient } from "@/lib/supabase/server";

import { StationPlayer } from "./station-player";

export const metadata: Metadata = { title: "Station" };
export const dynamic = "force-dynamic";

export default async function StationPage() {
  const { data } = await createServerClient().auth.getUser();
  const anonymous = !data?.user;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Station</h1>
      <p className="text-sm text-muted-foreground">
        {anonymous
          ? "AI-made songs from our own library, playing for you. Sign up free and the station learns what you like."
          : "Songs picked from our own library. What you like, skip and replay shapes what comes next."}
      </p>
      <StationPlayer anonymous={anonymous} />
    </main>
  );
}
