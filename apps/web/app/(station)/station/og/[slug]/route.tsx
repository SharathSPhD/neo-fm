/** OG card for a named station (/station?s=subah): its name and tagline on the shared share-card renderer. */
import { NextResponse } from "next/server";

import { renderShareCard } from "@/lib/share/card-image";
import { findStation } from "@/lib/station/named";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const station = findStation((await ctx.params).slug);
  if (!station) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return renderShareCard({
    title: `${station.name} on neo-fm Station`,
    subtitle: station.tagline,
    excerpt: [],
    seed: `neo-fm-station-${station.slug}`,
  });
}
