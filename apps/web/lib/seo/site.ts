/** Absolute origin used for canonical URLs, sitemap and Open Graph. */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://neo-fm-web.vercel.app");
  return raw.replace(/\/+$/, "");
}

/** Public, indexable marketing routes. Keep in sync with the (marketing) route group. */
export const PUBLIC_PATHS = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/station", changeFrequency: "daily", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/discover", changeFrequency: "daily", priority: 0.8 },
  { path: "/templates", changeFrequency: "monthly", priority: 0.6 },
  { path: "/ideas", changeFrequency: "monthly", priority: 0.7 },
  { path: "/trust", changeFrequency: "monthly", priority: 0.6 },
  { path: "/help", changeFrequency: "monthly", priority: 0.5 },
  { path: "/ai-disclosure", changeFrequency: "yearly", priority: 0.3 },
  { path: "/refusals", changeFrequency: "yearly", priority: 0.2 },
  { path: "/grievance", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
] as const;
