import type { MetadataRoute } from "next";

import { PUBLIC_PATHS, siteUrl } from "@/lib/seo/site";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Public songs change constantly; regenerate hourly rather than per request.
export const revalidate = 3600;

const MAX_SONGS = 1000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages: MetadataRoute.Sitemap = PUBLIC_PATHS.map((p) => ({
    url: `${base}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  // Only `public` songs are listed; `unlisted` ones are noindex and stay out.
  // A database hiccup must not take the sitemap down, so fall back to pages.
  try {
    const { data } = await createServiceRoleClient()
      .from("jobs")
      .select("public_id, published_at")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(MAX_SONGS);
    for (const row of data ?? []) {
      if (!row.public_id) continue;
      pages.push({
        url: `${base}/s/${row.public_id}`,
        lastModified: row.published_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.4,
      });
    }
  } catch {
    /* pages only */
  }
  return pages;
}
