/**
 * Localised OG image for /ai-songs/<language> (and the explainer under it, which inherits it).
 * The native-script lines are shaped with HarfBuzz by the share-card renderer; satori alone cannot
 * shape Indic scripts.
 */
import { renderShareCard } from "@/lib/share/card-image";
import { languagePageBySlug } from "@/lib/seo/language-pages";

export const runtime = "nodejs";
export const alt = "neo-fm: AI songs in Indian languages";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage(props: { params: Promise<{ lang: string }> }) {
  const params = await props.params;
  const page = languagePageBySlug(params.lang);
  if (!page) {
    return renderShareCard({ title: "neo-fm", subtitle: "AI music, India-first", excerpt: [], seed: params.lang });
  }
  return renderShareCard({
    title: "neo-fm",
    subtitle: `AI songs in ${page.english}`,
    excerpt: [page.native, page.cta],
    seed: page.code,
  });
}
