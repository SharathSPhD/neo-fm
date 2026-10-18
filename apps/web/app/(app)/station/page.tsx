import type { Metadata } from "next";

import { StationPlayer } from "./station-player";

export const metadata: Metadata = { title: "Station" };

export default function StationPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Station</h1>
      <p className="text-sm text-muted-foreground">
        Songs picked from our own library. What you like, skip and replay shapes what comes next.
      </p>
      <StationPlayer />
    </main>
  );
}
