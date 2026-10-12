import { unstable_cache } from "next/cache";
import Link from "next/link";

import { serverI18n } from "@/lib/i18n/server";
import { ProCta } from "@/components/pro-cta";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";
import { createServiceRoleClient } from "@/lib/supabase/server";

type Row = {
  public_id: string;
  song_documents: { title: string | null; language: string; style_family: string } | null;
};

/**
 * The strip shows only `public` songs, identical for every visitor, so it is
 * cached for a minute instead of costing every landing view a database round
 * trip. The service client is safe here: the query itself restricts to
 * completed, public songs and selects no private columns.
 */
const loadPublicStrip = unstable_cache(
  async (): Promise<Row[]> => {
    const { data } = await createServiceRoleClient()
      .from("jobs")
      .select("public_id, song_documents!inner ( title, language, style_family ), tracks!inner ( id )")
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(8)
      .returns<Row[]>();
    return data ?? [];
  },
  ["landing-listen-first"],
  { revalidate: 60 },
);

/** Landing-page strip: the newest community songs, playable without an account. */
export async function ListenFirst() {
  const { t } = await serverI18n();
  const rows = await loadPublicStrip().catch(() => [] as Row[]);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="listen-first" className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="listen-first" className="text-2xl font-medium tracking-tight">{t("listen.title")}</h2>
          <p className="mt-1 text-sm text-foreground/60">
            {t("listen.intro")}
          </p>
        </div>
        <Link href="/discover" className="text-sm text-accent underline">{t("listen.browse")}</Link>
      </div>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <li key={r.public_id}>
            <Link
              href={`/s/${r.public_id}`}
              className="block rounded-xl border border-border/60 p-4 transition hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <p className="line-clamp-2 font-medium">{r.song_documents?.title || t("song.untitled")}</p>
              <p className="mt-1 text-xs text-foreground/60">
                {r.song_documents ? `${prettyStyle(r.song_documents.style_family)} · ${prettyLanguage(r.song_documents.language)}` : ""}
              </p>
              <p className="mt-3 text-xs text-accent">{t("listen.play")}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <ProCta compact />
      </div>
    </section>
  );
}
