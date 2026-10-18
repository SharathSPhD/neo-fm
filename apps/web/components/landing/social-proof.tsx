import Link from "next/link";

import { loadCommunityStats, shouldShowStats } from "@/lib/landing/stats";

/**
 * Social proof from real data only. Renders nothing until the community is big enough for the numbers to help.
 * Song of the day and the weekly charts (PR "discover charts") slot in here once they are merged.
 */
export async function SocialProof() {
  const stats = await loadCommunityStats();
  if (!shouldShowStats(stats)) return null;
  return (
    <section aria-labelledby="proof-heading" className="border-t border-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="proof-heading" className="text-2xl font-semibold tracking-tight">Made by the community</h2>
          <p className="mt-2 text-sm text-foreground/70">
            {stats.songs} public songs across {stats.languages} languages, each one labelled AI-generated and open to listen to.
          </p>
        </div>
        <Link href="/discover" className="rounded-md border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-medium text-accent hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-accent">Browse what people made</Link>
      </div>
    </section>
  );
}
