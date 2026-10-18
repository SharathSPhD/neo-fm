import type { Metadata } from "next";

import { findStation } from "@/lib/station/named";

import { StationPlayer } from "./station-player";

export const metadata: Metadata = { title: "Station" };

export default async function StationPage({ searchParams }: { searchParams?: Promise<{ s?: string }> }) {
  // `/station?s=subah` opens a named station; anything unknown opens the listener's own station.
  const initialStation = findStation((await searchParams)?.s)?.slug ?? "";
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Station</h1>
      <p className="text-sm text-muted-foreground">
        Songs picked from our own library. What you like, skip and replay shapes what comes next.
      </p>
      <StationPlayer initialStation={initialStation} />
    </main>
  );
}
