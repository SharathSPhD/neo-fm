import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/s/"],
        // Account, app and API surfaces are not for crawlers. Unlisted songs
        // also carry a noindex meta tag.
        disallow: ["/api/", "/admin/", "/library", "/songs/", "/onboarding/", "/auth/"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
