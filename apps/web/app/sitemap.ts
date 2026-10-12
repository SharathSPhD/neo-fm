import type { MetadataRoute } from "next";

import { articlePath } from "@/lib/seo/language-articles";
import { LANGUAGE_PAGES, hreflangPaths, languagePagePath } from "@/lib/seo/language-pages";
import { PUBLIC_PATHS, siteUrl } from "@/lib/seo/site";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Public songs change constantly; regenerate hourly rather than per request.
export const revalidate = 3600;

const MAX_SONGS = 1000;
const MAX_PROFILES = 500;

/** hreflang cluster as absolute URLs; every member of the cluster carries the same map. */
function hreflangUrls(base: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hreflangPaths()).map(([lang, path]) => [lang, `${base}${path === "/" ? "" : path}`]),
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const languages = hreflangUrls(base);
  const pages: MetadataRoute.Sitemap = PUBLIC_PATHS.map((p) => ({
    url: `${base}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
    // The landing page is the English member of the hreflang cluster.
    ...(p.path === "/" ? { alternates: { languages } } : {}),
  }));
  for (const l of LANGUAGE_PAGES) {
    pages.push({
      url: `${base}${languagePagePath(l)}`,
      changeFrequency: "daily",
      priority: 0.8,
      alternates: { languages },
    });
    pages.push({ url: `${base}${articlePath(l)}`, changeFrequency: "monthly", priority: 0.6 });
  }

  // Only `public`, non-dedicated songs are listed; `unlisted` and dedicated ones are noindex and stay out.
  // A database hiccup must not take the sitemap down, so fall back to pages.
  try {
    const { data } = await createServiceRoleClient()
      .from("jobs")
      .select("public_id, published_at")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .is("dedication_to", null)
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

  // Creator profiles that have at least one public song (empty profiles are noindex).
  try {
    const db = createServiceRoleClient();
    const { data: owners } = await db
      .from("jobs")
      .select("user_id")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(MAX_SONGS);
    const ids = Array.from(new Set((owners ?? []).map((o) => o.user_id))).slice(0, MAX_PROFILES);
    if (ids.length > 0) {
      const { data: profiles } = await db
        .from("public_profiles" as never)
        .select("handle")
        .in("id", ids)
        .returns<{ handle: string | null }[]>();
      for (const p of profiles ?? []) {
        if (!p.handle) continue;
        pages.push({ url: `${base}/u/${p.handle}`, changeFrequency: "weekly", priority: 0.3 });
      }
    }
  } catch {
    /* songs and pages only */
  }
  return pages;
}
