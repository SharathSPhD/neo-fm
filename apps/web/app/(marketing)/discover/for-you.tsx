import Link from "next/link";

import { serverI18n } from "@/lib/i18n/server";
import { loadTaste, hasPersonalizationConsent } from "@/lib/personalization/load";
import { createServerClient } from "@/lib/supabase/server";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

type Row = { public_id: string; song_documents: { title: string | null; language: string; style_family: string } | null };

/** "For you": public songs ranked by the listener's own (consented, deletable) taste weights. Renders nothing without consent or signal. */
export async function ForYou() {
  const { t } = serverI18n();
  const supabase = createServerClient();
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return null;
  try {
    if (!(await hasPersonalizationConsent(supabase, userId))) return null;
    const { profile } = await loadTaste(supabase, userId);
    if (profile.nSignals < 3) return null;
    const { data } = await supabase
      .from("jobs")
      .select("public_id, song_documents!inner ( title, language, style_family ), tracks!inner ( id )")
      .eq("status", "completed").eq("published_visibility", "public").not("public_id", "is", null)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(80).returns<Row[]>();
    const ranked = (data ?? [])
      .map((r) => ({ r, s: (profile.weights.language[r.song_documents?.language ?? ""] ?? 0) + (profile.weights.style[r.song_documents?.style_family ?? ""] ?? 0) }))
      .filter((x) => x.s > 0.5).sort((a, b) => b.s - a.s).slice(0, 6);
    if (!ranked.length) return null;
    return (
      <section aria-labelledby="foryou-heading" className="flex flex-col gap-3">
        <h2 id="foryou-heading" className="text-lg font-medium">{t("discover.forYou")}</h2>
        <p className="text-xs text-foreground/50">{t("discover.forYouNote")}</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ranked.map(({ r }) => (
            <li key={r.public_id}>
              <Link href={`/s/${r.public_id}`} className="block rounded-lg border border-accent/30 bg-accent/5 p-4 hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent">
                <span className="font-medium">{r.song_documents?.title || t("song.untitled")}</span>
                <span className="mt-1 block text-xs text-foreground/60">{prettyLanguage(r.song_documents?.language ?? "")} · {prettyStyle(r.song_documents?.style_family ?? "")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  } catch {
    return null; // personalization is a nicety; never break Discover
  }
}
